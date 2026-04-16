import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, Events, GatewayIntentBits, PermissionsBitField } from 'discord.js';
import { loadConfig } from './config.js';
import { formatTrackingDate } from './date-format.js';

const lockFilePath = path.join(os.tmpdir(), 'discord-report-tracker.lock');
const config = loadConfig();
const manilaTimeZone = 'Asia/Manila';
const cutoffHour = 18;
const cutoffMinute = 0;
const checkedDateKeys = new Set();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseProcessLock(handle) {
  try {
    fs.closeSync(handle);
  } catch {
    // Ignore cleanup errors.
  }

  try {
    fs.unlinkSync(lockFilePath);
  } catch {
    // Ignore cleanup errors.
  }
}

function acquireProcessLock() {
  while (true) {
    try {
      const handle = fs.openSync(lockFilePath, 'wx');
      fs.writeFileSync(handle, String(process.pid));

      const cleanup = () => releaseProcessLock(handle);
      process.once('exit', cleanup);
      process.once('SIGINT', () => {
        cleanup();
        process.exit(0);
      });
      process.once('SIGTERM', () => {
        cleanup();
        process.exit(0);
      });

      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      try {
        const existingPid = Number.parseInt(fs.readFileSync(lockFilePath, 'utf8').trim(), 10);

        if (Number.isInteger(existingPid) && isProcessAlive(existingPid)) {
          console.error(`Another bot instance is already running with PID ${existingPid}.`);
          return false;
        }
      } catch {
        // Ignore stale lock read errors and retry.
      }

      try {
        fs.unlinkSync(lockFilePath);
      } catch {
        return false;
      }
    }
  }
}

if (!acquireProcessLock()) {
  process.exitCode = 1;
  process.exit(1);
}

function getManilaDateTimeParts(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: manilaTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  };
}

function getManilaDateKey(date) {
  const { year, month, day } = getManilaDateTimeParts(date);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatManilaDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeZone: manilaTimeZone,
  }).format(date);
}

function isBeforeCutoffInManila(date) {
  const { hour, minute } = getManilaDateTimeParts(date);
  return hour < cutoffHour || (hour === cutoffHour && minute < cutoffMinute);
}

function isAtOrAfterCutoffInManila(date) {
  const { hour, minute } = getManilaDateTimeParts(date);
  return hour > cutoffHour || (hour === cutoffHour && minute >= cutoffMinute);
}

function getDelayUntilNextCutoffMs(now = new Date()) {
  const manilaNow = getManilaDateTimeParts(now);
  const nowWall = Date.UTC(
    manilaNow.year,
    manilaNow.month - 1,
    manilaNow.day,
    manilaNow.hour,
    manilaNow.minute,
    manilaNow.second,
    now.getMilliseconds(),
  );

  let targetWall = Date.UTC(manilaNow.year, manilaNow.month - 1, manilaNow.day, cutoffHour, cutoffMinute, 0, 0);

  if (isAtOrAfterCutoffInManila(now)) {
    targetWall += 24 * 60 * 60 * 1000;
  }

  const delay = targetWall - nowWall;
  return Math.max(delay, 1000);
}

async function collectSubmitterIdsForDate(reportChannel, dateKey) {
  const submitterIds = new Set();
  let before;
  let hasOlderMessages = false;

  while (!hasOlderMessages) {
    const options = { limit: 100 };
    if (before) {
      options.before = before;
    }

    const messages = await reportChannel.messages.fetch(options);

    if (messages.size === 0) {
      break;
    }

    for (const message of messages.values()) {
      if (message.author.bot) {
        continue;
      }

      const messageDateKey = getManilaDateKey(message.createdAt);

      if (messageDateKey === dateKey && isBeforeCutoffInManila(message.createdAt)) {
        submitterIds.add(message.author.id);
      }

      if (messageDateKey < dateKey) {
        hasOlderMessages = true;
      }
    }

    before = messages.last()?.id;

    if (!before) {
      break;
    }
  }

  return submitterIds;
}

function splitLinesIntoMessages(lines, maxLength = 1900) {
  const chunks = [];
  let currentChunk = '';

  for (const line of lines) {
    const nextChunk = currentChunk ? `${currentChunk}\n${line}` : line;

    if (nextChunk.length <= maxLength) {
      currentChunk = nextChunk;
      continue;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    currentChunk = line;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

async function isAlreadyPostedForDate(notPassChannel, dateLabel) {
  const recentMessages = await notPassChannel.messages.fetch({ limit: 100 });

  return recentMessages.some(
    (message) => message.author.id === client.user.id && message.content.includes(`${dateLabel} |`) && message.content.includes('| Not Pass'),
  );
}

async function getEligibleMembers(reportChannel) {
  try {
    const members = await reportChannel.guild.members.fetch();
    return [...members.values()];
  } catch (error) {
    if (error?.code === 'GuildMembersTimeout') {
      const cachedMembers = [...reportChannel.guild.members.cache.values()];

      if (cachedMembers.length > 0) {
        console.warn(
          `Guild member fetch timed out for ${reportChannel.guild.name}; falling back to ${cachedMembers.length} cached members.`,
        );
        return cachedMembers;
      }
    }

    throw error;
  }
}

async function runDailyNotPassCheck() {
  const now = new Date();
  const todayKey = getManilaDateKey(now);
  const dateLabel = formatManilaDate(now);

  if (checkedDateKeys.has(todayKey)) {
    return;
  }

  const reportChannel = await client.channels.fetch(config.reportChannelId);
  const notPassChannel = await client.channels.fetch(config.notPassChannelId);

  if (!reportChannel || !reportChannel.isTextBased()) {
    console.warn(`Report channel ${config.reportChannelId} is not available.`);
    return;
  }

  if (!notPassChannel || !notPassChannel.isTextBased()) {
    console.warn(`Not-pass channel ${config.notPassChannelId} is not available.`);
    return;
  }

  const alreadyPosted = await isAlreadyPostedForDate(notPassChannel, dateLabel);
  if (alreadyPosted) {
    checkedDateKeys.add(todayKey);
    return;
  }

  const submitterIds = await collectSubmitterIdsForDate(reportChannel, todayKey);
  const members = await getEligibleMembers(reportChannel);
  const trackedMemberIdSet = new Set(config.trackedMemberIds);

  const eligibleMembers = members.filter((member) => {
    if (member.user.bot) {
      return false;
    }

    if (trackedMemberIdSet.size > 0 && !trackedMemberIdSet.has(member.id)) {
      return false;
    }

    const permissions = reportChannel.permissionsFor(member);
    if (!permissions) {
      return false;
    }

    return permissions.has(PermissionsBitField.Flags.ViewChannel) && permissions.has(PermissionsBitField.Flags.SendMessages);
  });

  const missingMembers = [...eligibleMembers.values()]
    .filter((member) => !submitterIds.has(member.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  if (missingMembers.length === 0) {
    checkedDateKeys.add(todayKey);
    console.log(`All eligible members submitted report on ${todayKey}.`);
    return;
  }

  const lines = missingMembers.map((member) => `${dateLabel} | ${member.displayName} | Not Pass`);

  for (const message of splitLinesIntoMessages(lines)) {
    await notPassChannel.send(message);
  }

  checkedDateKeys.add(todayKey);
  console.log(`Posted ${missingMembers.length} not-pass entries for ${todayKey}.`);
}

function scheduleDailyNotPassCheck() {
  const delayMs = getDelayUntilNextCutoffMs();

  setTimeout(async () => {
    try {
      await runDailyNotPassCheck();
    } catch (error) {
      console.error('Failed running daily not-pass check:', error);
    }

    scheduleDailyNotPassCheck();
  }, delayMs);

  const seconds = Math.floor(delayMs / 1000);
  console.log(`Next not-pass check in ${seconds} seconds.`);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  if (isAtOrAfterCutoffInManila(new Date())) {
    runDailyNotPassCheck().catch((error) => {
      console.error('Failed running startup not-pass check:', error);
    });
  }

  scheduleDailyNotPassCheck();
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) {
    return;
  }

  if (message.channelId !== config.reportChannelId) {
    return;
  }

  const trackingChannel = await client.channels.fetch(config.trackingChannelId);

  if (!trackingChannel || !trackingChannel.isTextBased()) {
    console.warn(`Tracking channel ${config.trackingChannelId} is not available.`);
    return;
  }

  const senderName = message.member?.displayName ?? message.author.globalName ?? message.author.username;
  const trackingDate = formatTrackingDate(message.createdAt);

  await trackingChannel.send(`${trackingDate} | ${senderName} | Accomplishment`);
});

client.login(config.token).catch((error) => {
  console.error('Failed to log in to Discord:', error);
  process.exitCode = 1;
});