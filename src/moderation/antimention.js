const { getGroupSettings, incrementWarning } = require('./store');

function getMentionedJids(message) {
  return (
    message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    message?.imageMessage?.contextInfo?.mentionedJid ||
    message?.videoMessage?.contextInfo?.mentionedJid ||
    []
  );
}

async function handleAntimention(sock, msg, { isAdmin, isBotAdmin } = {}) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid?.endsWith('@g.us')) return false;

  const settings = getGroupSettings(remoteJid);
  if (!settings.antimention) return false;
  if (isAdmin || isBotAdmin) return false;

  const mentioned = getMentionedJids(msg.message);
  const uniqueMentions = [...new Set(mentioned)];

  if (uniqueMentions.length <= settings.antimentionLimit) return false;

  const sender = msg.key.participant || msg.key.remoteJid;

  try {
    await sock.sendMessage(remoteJid, { delete: msg.key });

    const warnCount = incrementWarning(remoteJid, sender);
    const senderTag = `@${sender.split('@')[0]}`;

    await sock.sendMessage(remoteJid, {
      text: `🚫 ${senderTag} that's ${uniqueMentions.length} mentions in one message — over the limit of ${settings.antimentionLimit}. (Warning ${warnCount})`,
      mentions: [sender],
    });

    return true;
  } catch (err) {
    console.error('[antimention] Failed to delete message:', err.message);
    return false;
  }
}

module.exports = { handleAntimention, getMentionedJids };
