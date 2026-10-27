const { pool, ready } = require('../db');

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

// Serialize writes for the same group so concurrent dashboard/message updates
// do not overwrite each other based on stale reads.
const groupWriteQueues = new Map();

async function getStoredGroup(groupId) {
  await ready;
  const result = await pool.query(
    'SELECT settings FROM moderation_groups WHERE group_id = $1',
    [groupId]
  );
  return result.rows[0]?.settings || null;
}

function queueGroupWrite(groupId, operation) {
  const previous = groupWriteQueues.get(groupId) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  groupWriteQueues.set(groupId, next);
  return next.finally(() => {
    if (groupWriteQueues.get(groupId) === next) groupWriteQueues.delete(groupId);
  });
}

function getGroupSettings(groupId) {
  // Preserve the original synchronous API. Values are cached after first load;
  // on first call return defaults while the database read warms the cache.
  if (!groupCache.has(groupId)) {
    groupCache.set(groupId, { ...DEFAULT_GROUP_SETTINGS, warnings: {} });
    getStoredGroup(groupId).then(async (stored) => {
      if (stored) {
        const warnings = await getWarnings(groupId);
        groupCache.set(groupId, {
          ...DEFAULT_GROUP_SETTINGS,
          ...stored,
          warnings,
        });
      } else {
        await saveGroupSettings(groupId, groupCache.get(groupId));
      }
    }).catch((err) => console.error('[moderation/store] Load group settings failed:', err.message));
  }

  return {
    ...DEFAULT_GROUP_SETTINGS,
    ...groupCache.get(groupId),
    warnings: { ...(groupCache.get(groupId).warnings || {}) },
  };
}

const groupCache = new Map();

async function saveGroupSettings(groupId, settings) {
  await ready;
  const safeSettings = { ...settings };
  delete safeSettings.warnings;

  await pool.query(
    `INSERT INTO moderation_groups (group_id, settings, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (group_id)
     DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
    [groupId, JSON.stringify(safeSettings)]
  );
}

async function getWarnings(groupId) {
  await ready;
  const result = await pool.query(
    'SELECT participant_id, warning_count FROM moderation_warnings WHERE group_id = $1',
    [groupId]
  );
  return Object.fromEntries(result.rows.map((row) => [row.participant_id, Number(row.warning_count)]));
}

function updateGroupSettings(groupId, patch) {
  const current = getGroupSettings(groupId);
  const updated = { ...current, ...patch };
  if (patch.warnings) updated.warnings = { ...current.warnings, ...patch.warnings };
  groupCache.set(groupId, updated);

  queueGroupWrite(groupId, async () => {
    await saveGroupSettings(groupId, updated);
  }).catch((err) => console.error('[moderation/store] Save settings failed:', err.message));

  return { ...updated, warnings: { ...(updated.warnings || {}) } };
}

function incrementWarning(groupId, participantId) {
  const current = getGroupSettings(groupId);
  const nextCount = Number(current.warnings?.[participantId] || 0) + 1;
  const updated = {
    ...current,
    warnings: { ...(current.warnings || {}), [participantId]: nextCount },
  };
  groupCache.set(groupId, updated);

  queueGroupWrite(groupId, async () => {
    await ready;
    await pool.query(
      `INSERT INTO moderation_warnings
         (group_id, participant_id, warning_count, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (group_id, participant_id)
       DO UPDATE SET warning_count = EXCLUDED.warning_count, updated_at = NOW()`,
      [groupId, participantId, nextCount]
    );
    await saveGroupSettings(groupId, updated);
  }).catch((err) => console.error('[moderation/store] Save warning failed:', err.message));

  return nextCount;
}

const MAX_CACHE_SIZE = 2000;
const messageCache = new Map();

function cacheMessage(remoteJid, messageId, entry) {
  const key = `${remoteJid}:${messageId}`;
  messageCache.set(key, entry);
  if (messageCache.size > MAX_CACHE_SIZE) {
    const oldestKey = messageCache.keys().next().value;
    if (oldestKey !== undefined) messageCache.delete(oldestKey);
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
