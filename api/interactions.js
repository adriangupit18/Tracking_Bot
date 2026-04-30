import 'dotenv/config';

import nacl from 'tweetnacl';

import { SERVER_MEMBERS } from '../src/server-members.js';
import { addSubmission, getSubmissionsByDate } from '../src/storage.js';

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const INTERACTION_RESPONSE_CHANNEL_MESSAGE = 4;
const INTERACTION_RESPONSE_EPHEMERAL_FLAG = 64;
const SUB_COMMAND_TYPE = 1;
const TRACK_COMMAND_NAME = 'track';

const discordPublicKey = process.env.DISCORD_PUBLIC_KEY?.trim();

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

function getBodyFromKnownRequestFields(req) {
  const rawBody = req.rawBody;
  if (Buffer.isBuffer(rawBody)) {
    return rawBody.toString('utf8');
  }

  if (typeof rawBody === 'string') {
    return rawBody;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf8');
  }

  if (typeof req.body === 'string') {
    return req.body;
  }

  return null;
}

function readRequestBody(req) {
  const knownBody = getBodyFromKnownRequestFields(req);
  if (typeof knownBody === 'string') {
    return Promise.resolve(knownBody);
  }

  if (req.readableEnded) {
    return Promise.resolve('');
  }

  return new Promise((resolve) => {
    const chunks = [];

    const onData = (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    };

    const onEnd = () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    };

    req.on('data', onData);
    req.on('end', onEnd);
  });
}

function parseJsonBody(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function sendDiscordResponse(res, payload) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function verifyDiscordSignature(signature, timestamp, body) {
  if (!discordPublicKey) {
    return false;
  }

  const normalizedSignature = signature.trim().toLowerCase();

  try {
    return nacl.sign.detached.verify(
      Buffer.from(`${timestamp}${body}`),
      Buffer.from(normalizedSignature, 'hex'),
      Buffer.from(discordPublicKey, 'hex'),
    );
  } catch {
    return false;
  }
}

function getOption(options, name) {
  return Array.isArray(options) ? options.find((option) => option.name === name) : undefined;
}

function getTrackSubcommand(data) {
  return Array.isArray(data?.options) ? data.options.find((option) => option.type === SUB_COMMAND_TYPE) : undefined;
}

function getServerDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function isDateKey(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function formatLineList(prefix, names, emptyMessage) {
  if (names.length === 0) {
    return emptyMessage;
  }

  const lines = names.map((name) => `${prefix} ${name}`);
  const joined = lines.join('\n');

  if (joined.length <= 1900) {
    return joined;
  }

  const shortened = [];
  let currentLength = 0;

  for (const line of lines) {
    const candidateLength = currentLength === 0 ? line.length : currentLength + 1 + line.length;

    if (candidateLength > 1900) {
      break;
    }

    shortened.push(line);
    currentLength = candidateLength;
  }

  return `${shortened.join('\n')}\n...and ${lines.length - shortened.length} more`;
}

function buildDiscordResponse(content, { ephemeral = false } = {}) {
  const data = { content };

  if (ephemeral) {
    data.flags = INTERACTION_RESPONSE_EPHEMERAL_FLAG;
  }

  return {
    type: INTERACTION_RESPONSE_CHANNEL_MESSAGE,
    data,
  };
}

function getInteractionUser(interaction) {
  return interaction?.member?.user ?? interaction?.user ?? null;
}

async function handleSubmit(interaction) {
  const contentOption = getOption(interaction.data?.options, 'content');
  const content = String(contentOption?.value ?? '').trim();

  if (!content) {
    return buildDiscordResponse('Submission content is required.', { ephemeral: true });
  }

  const user = getInteractionUser(interaction);

  if (!user?.id) {
    return buildDiscordResponse('Unable to identify the submitting user.', { ephemeral: true });
  }

  const submission = {
    userId: String(user.id),
    username: String(user.username ?? user.global_name ?? 'Unknown'),
    date: getServerDateKey(),
    content,
  };

  const result = await addSubmission(submission);

  if (!result.inserted) {
    return buildDiscordResponse(`You already submitted on ${submission.date}.`, { ephemeral: true });
  }

  return buildDiscordResponse(`Saved your submission for ${submission.date}.`, { ephemeral: true });
}

async function handleTrackSubmitted(interaction) {
  const subcommand = getTrackSubcommand(interaction.data);
  const date = String(getOption(subcommand?.options, 'date')?.value ?? '').trim();

  if (!isDateKey(date)) {
    return buildDiscordResponse('Provide a date in YYYY-MM-DD format.', { ephemeral: true });
  }

  const submissions = await getSubmissionsByDate(date);
  const uniqueNames = [...new Set(submissions.map((entry) => entry.username).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );

  return buildDiscordResponse(formatLineList('✔', uniqueNames, `No submissions found for ${date}.`));
}

async function handleTrackMissing(interaction) {
  const subcommand = getTrackSubcommand(interaction.data);
  const date = String(getOption(subcommand?.options, 'date')?.value ?? '').trim();

  if (!isDateKey(date)) {
    return buildDiscordResponse('Provide a date in YYYY-MM-DD format.', { ephemeral: true });
  }

  if (SERVER_MEMBERS.length === 0) {
    return buildDiscordResponse('No server members are configured for the missing list.', { ephemeral: true });
  }

  const submissions = await getSubmissionsByDate(date);
  const submittedIds = new Set(submissions.map((entry) => String(entry.userId)));
  const missingNames = SERVER_MEMBERS.filter((member) => !submittedIds.has(String(member.userId)))
    .map((member) => member.username)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return buildDiscordResponse(formatLineList('❌', missingNames, `Everyone on the fixed server list submitted for ${date}.`));
}

async function handleInteractionPayload(interaction) {
  if (interaction?.type === INTERACTION_TYPE_PING) {
    return { type: INTERACTION_TYPE_PING };
  }

  if (interaction?.type !== INTERACTION_TYPE_APPLICATION_COMMAND) {
    return buildDiscordResponse('Unsupported interaction type.', { ephemeral: true });
  }

  const commandName = interaction.data?.name;

  if (commandName === 'submit') {
    return handleSubmit(interaction);
  }

  if (commandName === TRACK_COMMAND_NAME) {
    const subcommand = getTrackSubcommand(interaction.data);

    if (subcommand?.name === 'submitted') {
      return handleTrackSubmitted(interaction);
    }

    if (subcommand?.name === 'missing') {
      return handleTrackMissing(interaction);
    }
  }

  return buildDiscordResponse('Unknown command.', { ephemeral: true });
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    sendText(res, 200, 'Discord interaction endpoint is running.');
    return;
  }

  if (req.method !== 'POST') {
    sendText(res, 405, 'Method not allowed');
    return;
  }

  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];

  if (typeof signature !== 'string' || typeof timestamp !== 'string') {
    sendText(res, 401, 'Missing Discord signature headers.');
    return;
  }

  try {
    const rawBody = await readRequestBody(req);
    const interaction = parseJsonBody(rawBody);

    if (!interaction) {
      sendText(res, 400, 'Invalid interaction payload.');
      return;
    }

    if (interaction.type === INTERACTION_TYPE_PING) {
      sendDiscordResponse(res, { type: INTERACTION_TYPE_PING });
      return;
    }

    if (!verifyDiscordSignature(signature, timestamp, rawBody)) {
      sendText(res, 401, 'Invalid request signature.');
      return;
    }

    const response = await handleInteractionPayload(interaction);
    sendDiscordResponse(res, response);
  } catch (error) {
    console.error('[interactions] handler error:', error);
    if (!res.headersSent) {
      try {
        sendDiscordResponse(res, buildDiscordResponse('Internal server error.', { ephemeral: true }));
      } catch (responseError) {
        console.error('[interactions] failed to send error response:', responseError);
      }
    }
  }
}
