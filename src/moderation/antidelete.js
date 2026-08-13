const { getGroupSettings, cacheMessage, getCachedMessage } = require('./store');

function cacheIncomingMessage(msg) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid?.endsWith('@g.us')) return;
  if (!msg.message) return;

  const messageId = msg.key.id;
  const sender = msg.key.participant || msg.key.remoteJid;

  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    null;

  const type = Object.keys(msg.message)[0];

  cacheMessage(remoteJid, messageId, {
    sender,
    text,
    type,
    timestamp: Date.now(),
  });
}

async function handleRevoke(sock, msg) {
  const protocolMsg = msg.message?.protocolMessage;
  if (!protocolMsg || protocolMsg.type !== 0) return false;

  const remoteJid = msg.key.remoteJid;
  if (!remoteJid?.endsWith('@g.us')) return false;

  const settings = getGroupSettings(remoteJid);
  if (!settings.antidelete) return false;

  const originalKey = protocolMsg.key;
  const cached = getCachedMessage(remoteJid, originalKey.id);
  if (!cached) return false;

  const deletedBy = msg.key.participant || msg.key.remoteJid;
  const senderTag = `@${cached.sender.split('@')[0]}`;
  const deleterTag = `@${deletedBy.split('@')[0]}`;

  const content = cached.text
    ? `🗑️ *Deleted message recovered*\nFrom: ${senderTag}\nDeleted by: ${deleterTag}\n\n${cached.text}`
    : `🗑️ *Deleted message recovered*\nFrom: ${senderTag}\nDeleted by: ${deleterTag}\n(media message — content type: ${cached.type})`;

  await sock.sendMessage(remoteJid, {
    text: content,
    mentions: [cached.sender, deletedBy],
  });

  return true;
}

module.exports = { cacheIncomingMessage, handleRevoke };
