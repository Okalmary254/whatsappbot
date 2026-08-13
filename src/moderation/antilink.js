const { getGroupSettings, incrementWarning } = require('./store');

const LINK_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+\.[a-z]{2,})|(chat\.whatsapp\.com\/[^\s]+)|([a-z0-9-]+\.(com|net|org|io|co|ke|link|xyz)\/?[^\s]*)/i;

function containsLink(text) {
  if (!text) return false;
  return LINK_REGEX.test(text);
}

function extractText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ''
  );
}

async function handleAntilink(sock, msg, { isAdmin, isBotAdmin } = {}) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid?.endsWith('@g.us')) return false;

  const settings = getGroupSettings(remoteJid);
  if (!settings.antilink) return false;
  if (isAdmin || isBotAdmin) return false;

  const text = extractText(msg.message);
  if (!containsLink(text)) return false;

  const sender = msg.key.participant || msg.key.remoteJid;

  try {
    await sock.sendMessage(remoteJid, { delete: msg.key });

    const warnCount = incrementWarning(remoteJid, sender);
    const mentionTag = `@${sender.split('@')[0]}`;

    await sock.sendMessage(remoteJid, {
      text: `🚫 ${mentionTag} links aren't allowed in this group. (Warning ${warnCount})`,
      mentions: [sender],
    });

    return true;
  } catch (err) {
    console.error('[antilink] Failed to delete message:', err.message);
    return false;
  }
}

module.exports = { handleAntilink, containsLink };
