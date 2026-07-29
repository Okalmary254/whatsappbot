const logger = require('./logger');
const chatStore = require('./chatStore');

class StatusHandler {
  async handleStatus(sock, msg, config) {
    if (!config.bot.autoViewStatus) return;

    try {
      const key = msg.key;
      const participant = key.participant || key.remoteJid;
      const senderNumber = participant ? participant.split('@')[0] : 'Unknown';
      const pushName = msg.pushName || senderNumber;

      // Determine content type (Text, Image, Video)
      let contentType = 'Text';
      if (msg.message?.imageMessage) contentType = '📷 Image';
      else if (msg.message?.videoMessage) contentType = '🎥 Video';
      else if (msg.message?.conversation || msg.message?.extendedTextMessage) contentType = '📝 Text';

      const statusText = msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || 
                         msg.message?.imageMessage?.caption || 
                         msg.message?.videoMessage?.caption || '';

      // Record in ChatStore & DB
      chatStore.saveStatusView({
        id: key.id || Date.now().toString(),
        jid: participant,
        pushName,
        senderNumber,
        contentType,
        statusText,
        timestamp: msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now(),
        messageId: key.id
      });

      // Auto-View Status (Send read receipt for status@broadcast message)
      let participantJid = key.participant || key.remoteJid;
      if (participantJid && !participantJid.includes('@')) {
        participantJid = `${participantJid}@s.whatsapp.net`;
      }

      try {
        await sock.readMessages([{
          remoteJid: 'status@broadcast',
          id: key.id,
          participant: participantJid
        }]);
      } catch (e) {
        try {
          await sock.readMessages([key]);
        } catch (e2) {
          // Ignore read receipt error
        }
      }

      logger.log('status_view', `Auto-viewed status from ${pushName} (${senderNumber})`, {
        pushName,
        senderNumber,
        contentType,
        statusText,
        messageId: key.id
      });

      // Optional Auto-React to Status
      if (config.bot.autoReactStatus) {
        const emoji = config.bot.statusReactionEmoji || '💚';
        try {
          await sock.sendMessage('status@broadcast', {
            react: {
              text: emoji,
              key: key
            }
          }, { statusJidList: [participantJid] });

          logger.log('system', `Reacted with ${emoji} to ${pushName}'s status`);
        } catch (e) {
          console.error('Error reacting to status:', e);
        }
      }
    } catch (err) {
      console.error('Error auto-viewing status:', err);
      logger.log('error', `Failed to auto-view status: ${err.message}`);
    }
  }
}

module.exports = new StatusHandler();
