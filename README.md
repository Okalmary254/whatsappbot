# Whatsy: SQLite to Neon PostgreSQL code changes

This patch replaces the SQLite database adapter and JSON-file persistence for chat/config/moderation with PostgreSQL.

## Files included

- `src/db.js` — PostgreSQL pool, schema initialization, and query helpers.
- `src/chatStore.js` — chat/message/status persistence against PostgreSQL.
- `src/configManager.js` — configuration stored in the `bot_config` table.
- `src/moderation/store.js` — moderation settings and warning counts stored in PostgreSQL.
- `neon-schema.sql` — equivalent schema for manual execution in Neon.

## Apply

1. Copy the four files into the matching locations in your repository.
2. Install the PostgreSQL driver:
   ```bash
   npm install pg
   ```
3. After confirming no source file imports `sqlite3`, remove it:
   ```bash
   npm uninstall sqlite3
   ```
4. Set these environment variables in Render (without quotes around values):
   - `DATABASE_URL_POOLED` = Neon pooled connection string
   - `DATABASE_URL` = Neon direct connection string (fallback)
   - `GROQ_API_KEY` = your Groq key
   - `GROQ_MODEL` = `openai/gpt-oss-120b`
   - `HOST` = `0.0.0.0`
5. Use `npm start` as the Render start command. Keep your existing build command or use `npm ci`.
6. Ensure startup awaits `configManager.ready` before starting the bot or accepting configuration-changing dashboard requests. `src/db.js` creates tables automatically, and `configManager.ready` waits for the config table.
7. Run tests and check Render logs before using the bot.

## Important limitations

- This changes the live application storage code; it does **not** automatically import existing records from `data/bot_database.sqlite` or `data/moderation.json`. If those records matter, export/import them separately.
- `src/bot.js` in the provided source still uses Baileys `useMultiFileAuthState(AUTH_FOLDER)`. WhatsApp login credentials are therefore still file-based. Neon will not persist that folder. You need a persistent disk or a separate PostgreSQL-backed Baileys auth adapter before deployments/restarts can retain the WhatsApp session.
- The `getGroupSettings`, `updateGroupSettings`, and `incrementWarning` functions retain their original synchronous return shape, while PostgreSQL writes run asynchronously. The first settings read returns defaults while the database cache warms. For strict consistency, change these APIs and their callers to `async`/`await`.
- The database URL must be a valid Neon connection string, commonly with `?sslmode=require` and optionally `&channel_binding=require`. Do not commit it to Git.
