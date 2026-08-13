const { handleAntilink } = require('./antilink');
const { handleAntimention } = require('./antimention');
const { cacheIncomingMessage, handleRevoke } = require('./antidelete');
const { handleParticipantsUpdate } = require('./welcome');
const { handleCommand } = require('./commands');

async function getSenderPrivileges(sock, msg) {
  const remoteJid = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;

  const adminNumbers = (process.env.ADMIN_NUMBERS || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const isBotAdmin = adminNumbers.some((n) => sender.includes(n));

  let isAdmin = false;
  if (remoteJid.endsWith('@g.us')) {
    try {
      const meta = await sock.groupMetadata(remoteJid);
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
