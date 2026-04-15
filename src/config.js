import 'dotenv/config';

const requiredEnvironmentVariables = [
  'DISCORD_TOKEN',
  'REPORT_CHANNEL_ID',
  'TRACKING_CHANNEL_ID',
  'NOT_PASS_CHANNEL_ID',
];

export function loadConfig() {
  const missingVariables = requiredEnvironmentVariables.filter((name) => !process.env[name]);

  if (missingVariables.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVariables.join(', ')}`);
  }

  return {
    token: process.env.DISCORD_TOKEN,
    reportChannelId: process.env.REPORT_CHANNEL_ID,
    trackingChannelId: process.env.TRACKING_CHANNEL_ID,
    notPassChannelId: process.env.NOT_PASS_CHANNEL_ID,
  };
}