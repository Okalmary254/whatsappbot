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


## Multi-user Whatsy portal (feature branch)

The `feature/multi-user-whatsy` branch adds account signup/login at `/signup` and `/login`, with the private workspace at `/portal`. Each account has its own PostgreSQL settings/message records and a separate Baileys auth directory under `DATA_DIR/tenant_auth/<account-id>`.

### Required deployment configuration

- `DATABASE_URL_POOLED` (or `DATABASE_URL`) must point to the Neon PostgreSQL database.
- `GROQ_API_KEY` must be configured for AI replies.
- Set `HOST=0.0.0.0` and configure the existing `DASHBOARD_PASSWORD` for the legacy dashboard if you keep it exposed.
- Set `DATA_DIR` to a persistent Render disk mount. Without a persistent disk, per-account WhatsApp sessions will be lost on restart/redeploy.
- `ENABLE_LEGACY_BOT=false` is the default. Set it to `true` only if you intentionally want to run the old shared single-account bot alongside the new account-based portal. Do not share the old dashboard password with tenant users.

### Multi-user MVP scope and caveats

The portal currently supports signup/login, pairing-code connection, per-account auto-reply settings, AI instructions, pause/resume, and account-scoped recent message history. Tenant sessions use HttpOnly cookies and hashed server-side session tokens; passwords are stored as salted scrypt hashes. The Baileys auth files are isolated by account on disk, so use one application instance with persistent storage for this initial version. Add email verification, password reset, signup/login rate limiting, encrypted credential storage, and multi-instance session coordination before opening public self-service registration widely. Existing legacy account credentials are not automatically migrated into a tenant account.
