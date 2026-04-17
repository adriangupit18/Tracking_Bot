import 'dotenv/config';

const requiredEnvironmentVariables = [
  'DISCORD_TOKEN',
  'REPORT_CHANNEL_ID',
  'TRACKING_CHANNEL_ID',
  'NOT_PASS_CHANNEL_ID',
  'TRACKED_MEMBER_IDS',
];

function parseTrackedMemberIds(value) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig() {
  const missingVariables = requiredEnvironmentVariables.filter((name) => !process.env[name]);

  if (missingVariables.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVariables.join(', ')}`);
  }

  const trackedMemberIds = parseTrackedMemberIds(process.env.TRACKED_MEMBER_IDS);

  if (trackedMemberIds.length === 0) {
    throw new Error('TRACKED_MEMBER_IDS must contain at least one Discord user ID.');
  }

  return {
    token: process.env.DISCORD_TOKEN,
    reportChannelId: process.env.REPORT_CHANNEL_ID,
    trackingChannelId: process.env.TRACKING_CHANNEL_ID,
    notPassChannelId: process.env.NOT_PASS_CHANNEL_ID,
    trackedMemberIds,
  };
}