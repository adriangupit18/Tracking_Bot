# Discord Interactions Tracker

This project now runs as a slash-command-only Discord interactions endpoint for Vercel.

## What it does

- Verifies Discord interaction signatures with ED25519.
- Responds to `PING` with `type: 1`.
- Handles `/submit`, `/track submitted`, and `/track missing`.
- Stores submissions as `userId`, `username`, `date`, and `content`.
- Blocks duplicate submissions from the same user on the same day.
- Avoids `client.login()`, gateway events, and background schedulers.

## Commands

- `/submit content:<text>` saves the user's accomplishment and auto-fills the date from server time.
- `/track submitted date:<YYYY-MM-DD>` lists every user who submitted on that date.
- `/track missing date:<YYYY-MM-DD>` compares submissions against the fixed member list and lists the users who did not submit.

## Deployment

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Deploy the repo to Vercel.
4. Set the Discord interactions endpoint URL to `https://YOUR_PROJECT.vercel.app/api/interactions`.
5. Register the slash commands in the Discord Developer Portal or through the Discord API using the schema below.

## Environment variables

- `DISCORD_PUBLIC_KEY` - the Discord application public key used for request verification.
- `SERVER_MEMBERS_JSON` - JSON array of fixed server members for `/track missing`, for example `[{"userId":"123","username":"Alice"}]`.
- `SUPABASE_URL` - optional durable storage backend.
- `SUPABASE_SERVICE_ROLE_KEY` - optional Supabase service role key.
- `SUPABASE_TABLE_NAME` - optional Supabase table name, defaults to `submissions`.
- `SUBMISSIONS_FILE_PATH` - optional local JSON storage path. If unset, local dev uses `./data/submissions.json` and Vercel uses `/tmp`.

## Supabase table

If you want stable free storage, create a `submissions` table with these columns:

- `userId` text
- `username` text
- `date` text
- `content` text

Add a unique index on `(userId, date)` so duplicate submissions are blocked at the database level too.

## Slash command schema

Use these definitions when registering commands:

```json
[
	{
		"name": "submit",
		"description": "Submit an accomplishment",
		"options": [
			{
				"type": 3,
				"name": "content",
				"description": "Accomplishment text",
				"required": true
			}
		]
	},
	{
		"name": "track",
		"description": "Track submissions",
		"options": [
			{
				"type": 1,
				"name": "submitted",
				"description": "List users who submitted on a date",
				"options": [
					{
						"type": 3,
						"name": "date",
						"description": "YYYY-MM-DD",
						"required": true
					}
				]
			},
			{
				"type": 1,
				"name": "missing",
				"description": "List users who did not submit on a date",
				"options": [
					{
						"type": 3,
						"name": "date",
						"description": "YYYY-MM-DD",
						"required": true
					}
				]
			}
		]
	}
]
```

## Run locally

```bash
npm start
```

Then send Discord interaction requests to `http://localhost:3000/api/interactions`.