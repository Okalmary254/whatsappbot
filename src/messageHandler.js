const logger = require('./logger');
const aiService = require('./aiService');

class MessageHandler {
  async handleMessage(sock, msg, config) {
    if (!config.bot.autoReply) return;

    const key = msg.key;
    const remoteJid = key.remoteJid;

    // Ignore status messages, self messages, or empty messages
    if (!remoteJid || remoteJid === 'status@broadcast' || key.fromMe) return;

    const isGroup = remoteJid.endsWith('@g.us');

    // Check group chat setting
    if (isGroup && config.bot.ignoreGroups) return;

    // Extract sender number & pushName
    const senderNumber = (key.participant || remoteJid).split('@')[0];
    const pushName = msg.pushName || senderNumber;

    // Filter allowed / ignored senders if configured
    if (config.bot.ignoredSenders && config.bot.ignoredSenders.length > 0) {
      if (config.bot.ignoredSenders.includes(senderNumber)) return;
    }
    if (config.bot.allowedSenders && config.bot.allowedSenders.length > 0) {
      if (!config.bot.allowedSenders.includes(senderNumber)) return;
    }

    // Extract message body text
    const incomingText = msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || 
                         msg.message?.imageMessage?.caption || 
                         msg.message?.videoMessage?.caption || '';

    if (!incomingText || incomingText.trim() === '') return;

    logger.log('incoming_message', `Received message from ${pushName} (${senderNumber}): "${incomingText}"`, {
      pushName,
      senderNumber,
      remoteJid,
      text: incomingText
    });

    try {
      // Simulate typing presence for natural feeling
      await sock.sendPresenceUpdate('composing', remoteJid);
      
      const delayMs = config.bot.naturalDelayMs || 2000;
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Generate AI or rule response
      const responseText = await aiService.generateResponse(incomingText, [], config);

      if (responseText) {
        // Send reply back on WhatsApp
        await sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
        await sock.sendPresenceUpdate('paused', remoteJid);

        logger.log('auto_reply', `Auto-replied to ${pushName} (${senderNumber}): "${responseText}"`, {
          pushName,
          senderNumber,
          remoteJid,
          incomingText,
          replyText: responseText
        });
      } else {
        await sock.sendPresenceUpdate('paused', remoteJid);
      }
    } catch (err) {
      console.error('Error handling message auto-reply:', err);
      logger.log('error', `Failed to reply to ${pushName}: ${err.message}`);
    }
  }
}

module.exports = new MessageHandler();
