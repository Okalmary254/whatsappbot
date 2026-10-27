const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const DB_PATH = path.join(DATA_DIR, 'data', 'bot_database.sqlite');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err);
  } else {
    console.log('📦 Connected to persistent SQLite database at:', DB_PATH);
  }
});

// Helper for DB queries using Promises
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Initialize tables; callers await ready before reading persisted state.
async function initDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      phoneNumber TEXT,
      unreadCount INTEGER DEFAULT 0,
      lastMessage TEXT,
      lastTimestamp INTEGER,
      isGroup INTEGER DEFAULT 0,
      hasDeletedMessages INTEGER DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      jid TEXT,
      fromMe INTEGER,
      text TEXT,
      timestamp INTEGER,
      pushName TEXT,
      isDeleted INTEGER DEFAULT 0,
      deletedAt INTEGER
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS status_views (
      id TEXT PRIMARY KEY,
      jid TEXT,
      pushName TEXT,
      senderNumber TEXT,
      contentType TEXT,
      statusText TEXT,
      timestamp INTEGER,
      messageId TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS bot_state (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_messages_jid_timestamp ON messages(jid, timestamp)');
  await run('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)');
}

const ready = initDatabase();
ready.catch(err => console.error('Error initializing SQLite DB tables:', err));

module.exports = { db, run, get, all, ready };
