# Discord Cipher Hunt Bot

TypeScript · discord.js 14 · PostgreSQL · Prisma. Implements PRD v1.1 with prefix commands (`./cipher`, `./answer`, `./pass`, …).

## Setup
1. Create a bot in the Discord Developer Portal and enable the **Message Content** privileged intent. Invite it with permission to read/send messages, attach files and embed links.
2. `cp .env.example .env` and fill in `DISCORD_TOKEN`, `DATABASE_URL`, admin IDs, and the leaderboard/log channel IDs (make those channels private to admins).
3. Edit `config/teams.json` (role ID and/or user IDs per team) and `config/questions.json` (image file in `images/` or an https URL, difficulty, accepted answers). Replace the `CHANGE_ME` answers.
4. Install and prepare the database:
   ```
   npm install
   npx prisma migrate dev --name init
   npm run seed
   ```
5. Run: `npm run dev` (or `npm run build && npm start`). Then, in the admin channel: `./start`.

Re-running `npm run seed` updates team roles/members and question metadata without touching game state.

## Design notes
- **Source of truth is PostgreSQL.** Every state change runs in one transaction under a global `pg_advisory_xact_lock`, so concurrent `./answer`/`./pass` commands are serialized. Unique constraints on `Attempt.messageId` and `Ledger(commandId, teamId, type)` plus an in-memory guard prevent double-processing.
- **Leaderboard** (`src/leaderboard.ts`) edits one persistent message, coalesces bursts of updates into a final pass that re-reads committed scores, retries with backoff on failure, and recreates the message if it was deleted. It is triggered after every accepted answer, pass, start, reset, adjust, and on bot startup.
- **Team identity** comes from Discord user IDs / roles, never from typed names. Users matching zero or several teams are rejected.
- **Pause vs stop:** `./stop` pauses (all gameplay rejected), `./resume` continues. `./start` only works on a fresh/reset event; it seeds 100 points and every active question into each team's queue.
- **Reset** zeroes scores, clears attempts/ledger/queues, sets the event inactive, and refreshes the board. The cleared ledger size is written to the log channel (use `./export` first for a full CSV).
- **Re-requesting `./cipher`** with an active question re-sends that question's image (handy if the first send failed); it never replaces it.
- **Extras beyond the PRD:** `./adjust`, `./export`, `./config floor|autonext`.

## Tests
`npm test` (normalization and ranking unit tests).
