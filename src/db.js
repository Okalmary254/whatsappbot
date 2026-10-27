const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL_POOLED ||
  process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL_POOLED or DATABASE_URL must be configured for PostgreSQL.'
  );
}

const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSLMODE === 'disable'
    ? false
    : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX) || 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

// Convert SQLite-style ? placeholders to PostgreSQL $1, $2, ...
// This supports the parameterized statements used by the existing project.
function toPostgresPlaceholders(sql) {
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let output = '';

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];

    if (char === "'" && !inDoubleQuote) {
      // SQL escapes a single quote by doubling it.
      if (inSingleQuote && sql[i + 1] === "'") {
        output += "''";
        i += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      output += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && sql[i + 1] === '"') {
        output += '""';
        i += 1;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      output += char;
      continue;
    }

    if (char === '?' && !inSingleQuote && !inDoubleQuote) {
      index += 1;
      output += `$${index}`;
    } else {
      output += char;
    }
  }

  return output;
}

async function initDatabase() {
  // Use snake_case identifiers throughout PostgreSQL to avoid quoted-name issues.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      phone_number TEXT,
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message TEXT,
      last_timestamp BIGINT,
      is_group BOOLEAN NOT NULL DEFAULT FALSE,
      has_deleted_messages BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      jid TEXT NOT NULL,
      from_me BOOLEAN NOT NULL DEFAULT FALSE,
      text TEXT,
      timestamp BIGINT NOT NULL,
      push_name TEXT,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS status_views (
      id TEXT PRIMARY KEY,
      jid TEXT,
      push_name TEXT,
      sender_number TEXT,
      content_type TEXT,
      status_text TEXT,
      timestamp BIGINT NOT NULL,
      message_id TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_state (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_config (
      config_key TEXT PRIMARY KEY,
      config JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_groups (
      group_id TEXT PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_warnings (
      group_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, participant_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_jid_timestamp
    ON messages (jid, timestamp)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp
    ON messages (timestamp)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_status_views_timestamp
    ON status_views (timestamp)
  `);

  console.log('Connected to PostgreSQL and verified database schema.');
}

const ready = initDatabase().catch((err) => {
  console.error('Error initializing PostgreSQL database:', err);
  throw err;
});

async function query(sql, params = []) {
  await ready;
  return pool.query(toPostgresPlaceholders(sql), params);
}

async function run(sql, params = []) {
  const result = await query(sql, params);
  return {
    changes: result.rowCount,
    rowCount: result.rowCount,
    rows: result.rows,
  };
}

async function get(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0];
}

async function all(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

async function closeDatabase() {
  await pool.end();
}

module.exports = { db: pool, pool, query, run, get, all, ready, closeDatabase };
