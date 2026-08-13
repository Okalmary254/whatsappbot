const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.WHATSY_DB_PATH || path.join(__dirname, '..', '..', 'data', 'moderation.json');

function ensureDB() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ groups: {} }, null, 2));
  }
}

function readDB() {
  ensureDB();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    console.error('[store] Failed to read DB, resetting:', err.message);
    const fresh = { groups: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function writeDB(data) {
  ensureDB();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

const DEFAULT_GROUP_SETTINGS = {
  antilink: false,
  antidelete: false,
  antimention: false,
  antimentionLimit: 5,
  welcome: false,
  welcomeMessage: 'Welcome to the group, {mention}! 👋 Please check the pinned rules.',
  goodbyeMessage: null,
  warnings: {},
};

function getGroupSettings(groupId) {
  const db = readDB();
  if (!db.groups[groupId]) {
    db.groups[groupId] = { ...DEFAULT_GROUP_SETTINGS };
    writeDB(db);
  }
  return { ...DEFAULT_GROUP_SETTINGS, ...db.groups[groupId] };
}

function updateGroupSettings(groupId, patch) {
  const db = readDB();
  const current = db.groups[groupId] || { ...DEFAULT_GROUP_SETTINGS };
  db.groups[groupId] = { ...current, ...patch };
  writeDB(db);
  return db.groups[groupId];
}

function incrementWarning(groupId, participantId) {
  const db = readDB();
  const group = db.groups[groupId] || { ...DEFAULT_GROUP_SETTINGS, warnings: {} };
  group.warnings = group.warnings || {};
  group.warnings[participantId] = (group.warnings[participantId] || 0) + 1;
  db.groups[groupId] = group;
  writeDB(db);
  return group.warnings[participantId];
}

const MAX_CACHE_SIZE = 2000;
const messageCache = new Map();

function cacheMessage(remoteJid, messageId, entry) {
  const key = `${remoteJid}:${messageId}`;
  messageCache.set(key, entry);
  if (messageCache.size > MAX_CACHE_SIZE) {
    const oldestKey = messageCache.keys().next().value;
    messageCache.delete(oldestKey);
  }
}

function getCachedMessage(remoteJid, messageId) {
  return messageCache.get(`${remoteJid}:${messageId}`);
}

module.exports = {
  getGroupSettings,
  updateGroupSettings,
  incrementWarning,
  cacheMessage,
  getCachedMessage,
  DEFAULT_GROUP_SETTINGS,
};
