# Discord Report Tracker

This bot watches the accomplishment report channel and posts a minimal tracking entry into a second channel.

## What it does

- Listens for new messages in the report channel.
- Ignores bot messages.
- Posts the sender name and the message timestamp to the tracking channel.
- At 6:00 PM Manila time, checks who did not submit in the report channel and posts `Date | Name | Not Pass` to a separate not-pass channel.
- Uses the tracking channel as the log, so no database is required.

## Setup

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and add your Discord bot token.
4. In the Discord Developer Portal, enable the Message Content intent for the bot.
5. Invite the bot to your server with permission to read and send messages in all configured channels.

## Environment variables

- `DISCORD_TOKEN` - the bot token.
- `REPORT_CHANNEL_ID` - the channel where accomplishment reports are posted.
- `TRACKING_CHANNEL_ID` - the channel where tracking entries are written.
- `NOT_PASS_CHANNEL_ID` - the channel where not-pass entries are written at 6:00 PM Manila time.
- `TRACKED_MEMBER_IDS` - optional comma-separated Discord user IDs to limit not-pass checks to specific members (for example, your 7 expected members).

## Run

```bash
npm start
```