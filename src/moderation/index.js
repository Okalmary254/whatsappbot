const { handleAntilink } = require('./antilink');
const { handleAntimention } = require('./antimention');
const { cacheIncomingMessage, handleRevoke } = require('./antidelete');
const { handleParticipantsUpdate } = require('./welcome');
const { handleCommand } = require('./commands');
const groupAdminCache = new Map();
const ADMIN_CACHE_TTL_MS = 60 * 1000;

async function getSenderPrivileges(sock, msg) {
  const remoteJid = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;

  const adminNumbers = (process.env.ADMIN_NUMBERS || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const senderNumber = String(sender).split('@')[0].split(':')[0].replace(/\D/g, '');
  const isBotAdmin = adminNumbers.some((n) => String(n).replace(/\D/g, '') === senderNumber);

  let isAdmin = false;
  if (remoteJid.endsWith('@g.us')) {
    try {
      let meta = groupAdminCache.get(remoteJid);
      if (!meta || Date.now() - meta.cachedAt > ADMIN_CACHE_TTL_MS) {
        const fetched = await sock.groupMetadata(remoteJid);
        meta = { participants: fetched.participants || [], cachedAt: Date.now() };
        groupAdminCache.set(remoteJid, meta);
      }
      const participant = meta.participants.find((p) => p.id === sender);
      isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
    } catch (err) {
      console.error('[privileges] groupMetadata fetch failed:', err.message);
    }
  }

  return { isAdmin, isBotAdmin };
}

async function onIncomingMessage(sock, msg) {
  // 1. Always cache first (needed for antidelete to work later)
  cacheIncomingMessage(msg);

  // 2. Handle revoke (delete) events
  const wasRevoke = await handleRevoke(sock, msg);
  if (wasRevoke) return 'revoke';

  const { isAdmin, isBotAdmin } = await getSenderPrivileges(sock, msg);

  // 3. Admin commands (/antilink, /antidelete, /antimention, /welcome)
  const wasCommand = await handleCommand(sock, msg, { isAdmin, isBotAdmin });
  if (wasCommand) return true;

  // 4. Moderation checks (order matters: link check before mention check)
  const wasLinkActioned = await handleAntilink(sock, msg, { isAdmin, isBotAdmin });
  if (wasLinkActioned) return true;

  const wasMentionActioned = await handleAntimention(sock, msg, { isAdmin, isBotAdmin });
  if (wasMentionActioned) return true;

  return false;
}

module.exports = {
  onIncomingMessage,
  handleParticipantsUpdate,
  getSenderPrivileges,
};
