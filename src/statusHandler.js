const logger = require('./logger');

class StatusHandler {
  async handleStatus(sock, msg, config) {
    if (!config.bot.autoViewStatus) return;

    try {
      const key = msg.key;
      const participant = key.participant || key.remoteJid;
      const senderNumber = participant.split('@')[0];
      const pushName = msg.pushName || senderNumber;

      // Determine content type (Text, Image, Video)
      let contentType = 'Text / Unknown';
      if (msg.message?.imageMessage) contentType = '📷 Image';
      else if (msg.message?.videoMessage) contentType = '🎥 Video';
      else if (msg.message?.conversation || msg.message?.extendedTextMessage) contentType = '📝 Text';

      const statusText = msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || 
                         msg.message?.imageMessage?.caption || 
                         msg.message?.videoMessage?.caption || '';

      // Auto-View Status (Send read receipt for status@broadcast message)
      await sock.readMessages([{
        remoteJid: 'status@broadcast',
        id: key.id,
        participant: key.participant || key.remoteJid
      }]);

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
        await sock.sendMessage('status@broadcast', {
          react: {
            text: emoji,
            key: key
          }
        }, { statusJidList: [participant] });

        logger.log('system', `Reacted with ${emoji} to ${pushName}'s status`);
      }
    } catch (err) {
      console.error('Error auto-viewing status:', err);
      logger.log('error', `Failed to auto-view status: ${err.message}`);
    }
  }
}

module.exports = new StatusHandler();
