const { getGroupSettings } = require('./store');

function renderTemplate(template, { mention, groupName, count }) {
  return template
    .replace(/{mention}/g, mention)
    .replace(/{group}/g, groupName || 'the group')
    .replace(/{count}/g, String(count ?? ''));
}

async function handleParticipantsUpdate(sock, update) {
  const { id: groupJid, participants, action } = update;
  if (action !== 'add' && action !== 'remove') return;

  const settings = getGroupSettings(groupJid);
  if (!settings.welcome) return;

  let groupName = groupJid;
  let participantCount;
  try {
    const meta = await sock.groupMetadata(groupJid);
    groupName = meta.subject;
    participantCount = meta.participants.length;
  } catch (err) {
    console.error('[welcome] Could not fetch group metadata:', err.message);
  }

  for (const jid of participants) {
    const mentionTag = `@${jid.split('@')[0]}`;

    if (action === 'add') {
      const text = renderTemplate(settings.welcomeMessage, {
        mention: mentionTag,
        groupName,
        count: participantCount,
      });
      await sock.sendMessage(groupJid, { text, mentions: [jid] });
    } else if (action === 'remove' && settings.goodbyeMessage) {
      const text = renderTemplate(settings.goodbyeMessage, {
        mention: mentionTag,
        groupName,
        count: participantCount,
      });
      await sock.sendMessage(groupJid, { text, mentions: [jid] });
    }
  }
}

module.exports = { handleParticipantsUpdate, renderTemplate };
