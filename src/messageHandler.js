const logger = require('./logger');
const aiService = require('./aiService');
const chatStore = require('./chatStore');
const configManager = require('./configManager');
const lastReplyAt = new Map();
const SENDER_COOLDOWN_MS = Math.max(1000, Number(process.env.SENDER_COOLDOWN_MS) || 5000);

class MessageHandler {
  async handleMessage(sock, msg, config) {
    const key = msg.key;
    const remoteJid = key.remoteJid;

    // Ignore status updates
    if (!remoteJid || remoteJid === 'status@broadcast') return;

    const isGroup = remoteJid.endsWith('@g.us');
    const senderNumber = (key.participant || remoteJid).split('@')[0];
    const pushName = msg.pushName || senderNumber;

    // Extract incoming message text
    const incomingText = msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text ||
                         msg.message?.imageMessage?.caption ||
                         msg.message?.videoMessage?.caption || '';

    if (!incomingText || incomingText.trim() === '') return;

    const trimmedText = incomingText.trim();

    // -------------------------------------------------------------
    // OWNER COMMANDS (Sent from own number / self or owner account)
    // -------------------------------------------------------------
    const selfJid = sock.user?.id ? (sock.user.id.split(':')[0].split('@')[0] + '@s.whatsapp.net') : null;
    if (key.fromMe || senderNumber === sock.user?.id?.split(':')[0]?.split('@')[0]) {
      if (trimmedText.startsWith('/') && key.fromMe && remoteJid === selfJid) {
        await this.handleOwnerCommand(sock, remoteJid, trimmedText, msg, config);
        return;
      }
      // If it's a regular message sent by owner, don't auto-reply to oneself
      return;
    }

    // Per-contact controls are available to every user in a direct chat.
    // They pause only replies to that contact, not the whole bot.
    if (!key.fromMe && !isGroup && /^\/(pause|resume|unpause|status|help)(?:\\s|$)/i.test(trimmedText)) {
      const cmd = trimmedText.split(/\\s+/)[0].toLowerCase();
      const currentConfig = configManager.getConfig();
      const pausedSenders = Array.isArray(currentConfig.bot.pausedSenders)
        ? currentConfig.bot.pausedSenders.map(String)
        : [];
      const isPausedForThisUser = pausedSenders.includes(senderNumber);

      if (cmd === '/pause') {
        if (!isPausedForThisUser) {
          configManager.updateConfig({ bot: { pausedSenders: [...pausedSenders, senderNumber] } });
        }
        await sock.sendMessage(remoteJid, {
          text: '⏸️ *Replies paused for this chat.* I will stop replying to your messages. Send /resume whenever you want me to reply again.'
        }, { quoted: msg });
        logger.log('system', `User ${senderNumber} paused replies for their chat.`);
        return;
      }

      if (cmd === '/resume' || cmd === '/unpause') {
        configManager.updateConfig({
          bot: { pausedSenders: pausedSenders.filter(number => number !== senderNumber) }
        });
        await sock.sendMessage(remoteJid, {
          text: '▶️ *Replies resumed for this chat.* You can send /pause at any time to stop replies again.'
        }, { quoted: msg });
        logger.log('system', `User ${senderNumber} resumed replies for their chat.`);
        return;
      }

      if (cmd === '/status') {
        await sock.sendMessage(remoteJid, {
          text: `*Your chat status:* ${isPausedForThisUser ? '⏸️ Paused' : '✅ Active'}\\nSend /pause to stop replies to you, or /resume to enable them again.`
        }, { quoted: msg });
        return;
      }

      if (cmd === '/help') {
        await sock.sendMessage(remoteJid, {
          text: '*WhatsApp AI Assistant commands*\\n/pause - Stop replies to you\\n/resume - Start replies to you again\\n/status - Check your reply status'
        }, { quoted: msg });
        return;
      }
    }

    // -------------------------------------------------------------
    // AUTOMATIC REPLIES FOR INCOMING CONTACT MESSAGES
    // -------------------------------------------------------------

    // Check if autoReply is disabled globally or paused via /pause command
    if (!config.bot.autoReply) return;
    if (config.bot.isPaused) {
      logger.log('system', `⏸️ Skipped auto-reply to ${pushName} because bot auto-reply is currently PAUSED.`);
      return;
    }

    // Check group chat setting
    if (isGroup && config.bot.ignoreGroups) return;

    // A user's pause affects only their own direct chat.
    const pausedSenders = Array.isArray(config.bot.pausedSenders) ? config.bot.pausedSenders : [];
    if (!isGroup && pausedSenders.includes(senderNumber)) {
      logger.log('system', `Skipped auto-reply to ${senderNumber}: this user has paused replies.`);
      return;
    }


    // Check Ignored numbers filter (IGNORE_NUMBERS env / config)
    if (config.bot.ignoredSenders && config.bot.ignoredSenders.length > 0) {
      if (config.bot.ignoredSenders.includes(senderNumber)) {
        logger.log('system', `🚫 Skipped auto-reply to ignored number: ${senderNumber}`);
        return;
      }
    }

    // Check Whitelist mode filter (WHITELIST_MODE env / config)
    if (config.bot.whitelistMode || (config.bot.allowedSenders && config.bot.allowedSenders.length > 0)) {
      if (!config.bot.allowedSenders || !config.bot.allowedSenders.includes(senderNumber)) {
        logger.log('system', `🛡️ Whitelist mode active: Skipped reply to non-whitelisted number: ${senderNumber}`);
        return;
      }
    }

    const now = Date.now();
    const previousReplyAt = lastReplyAt.get(senderNumber) || 0;
    if (now - previousReplyAt < SENDER_COOLDOWN_MS) {
      logger.log('system', 'Rate limited incoming message from ' + senderNumber + '.');
      return;
    }
    lastReplyAt.set(senderNumber, now);
    if (lastReplyAt.size > 5000) {
      for (const [number, at] of lastReplyAt) if (now - at > 60 * 60 * 1000) lastReplyAt.delete(number);
    }

    logger.log('incoming_message', `Received message from ${pushName} (${senderNumber}): "${incomingText}"`, {
      pushName,
      senderNumber,
      remoteJid,
      text: incomingText
    });

    try {
      // Calculate randomized human-like delay
      const minDelay = config.bot.minDelayMs || 2000;
      const maxDelay = config.bot.maxDelayMs || 5000;
      const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

      // Start AI generation immediately so the typing delay overlaps model latency.
      const chatHistory = chatStore.getMessages(remoteJid);
      const responsePromise = aiService.generateResponse(incomingText, chatHistory, config);
      await sock.sendPresenceUpdate('composing', remoteJid);
      if (randomDelay > 0) await new Promise(resolve => setTimeout(resolve, randomDelay));
      const responseText = await responsePromise;

      if (responseText) {
        // Send reply back on WhatsApp
        const sentMsg = await sock.sendMessage(remoteJid, { text: responseText }, { quoted: msg });
        await sock.sendPresenceUpdate('paused', remoteJid);

        // Record bot's auto-reply in ChatStore & DB
        chatStore.addMessage({
          jid: remoteJid,
          id: sentMsg?.key?.id,
          fromMe: true,
          text: responseText,
          pushName: 'Me (Bot)',
          timestamp: Date.now(),
          isGroup: isGroup
        });

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

  async handleOwnerCommand(sock, remoteJid, commandText, msg, config) {
    const cmd = commandText.split(' ')[0].toLowerCase();
    const ownerName = config.bot?.ownerName || process.env.ASSISTANT_OWNER_NAME || 'John';

    if (cmd === '/pause') {
      configManager.setPaused(true);
      const reply = `⏸️ *Auto-Reply Paused*\nBot auto-reply is now paused. I will not auto-reply to incoming contact DMs until you send /resume.`;
      await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
      logger.log('system', `⏸️ Owner paused auto-replies.`);

    } else if (cmd === '/resume' || cmd === '/unpause') {
      configManager.setPaused(false);
      const reply = `▶️ *Auto-Reply Resumed*\nBot auto-reply is now active and listening for incoming messages.`;
      await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
      logger.log('system', `▶️ Owner resumed auto-replies.`);

    } else if (cmd === '/deleted') {
      const deletedMsgs = chatStore.getDeletedMessages().slice(0, 10);
      if (deletedMsgs.length === 0) {
        await sock.sendMessage(remoteJid, { text: '🗑️ No deleted messages recorded yet.' }, { quoted: msg });
        return;
      }

      let report = `🗑️ *Recently Restored Deleted Messages (${deletedMsgs.length})*:\n\n`;
      deletedMsgs.forEach((m, idx) => {
        const timeStr = new Date(m.deletedAt || m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        report += `${idx + 1}. *${m.pushName || m.phoneNumber}* (${timeStr}):\n   "${m.text}"\n`;
      });

      await sock.sendMessage(remoteJid, { text: report }, { quoted: msg });
      logger.log('system', `🗑️ Owner requested deleted messages report.`);

    } else if (cmd === '/help' || cmd === '/status') {
      const statusText = `🤖 *WhatsApp AI Assistant Status*\n\n` +
        `• *Owner Name*: ${ownerName}\n` +
        `• *Auto-Reply*: ${config.bot.isPaused ? '⏸️ PAUSED' : '✅ ACTIVE'}\n` +
        `• *AI Provider*: ${config.ai.provider.toUpperCase()}\n` +
        `• *Reply Mode*: ${config.bot.replyMode}\n` +
        `• *Delay Range*: ${config.bot.minDelayMs}ms - ${config.bot.maxDelayMs}ms\n` +
        `• *Group Replies*: ${config.bot.ignoreGroups ? 'Disabled' : 'Enabled'}\n` +
        `• *Whitelist Mode*: ${config.bot.whitelistMode ? 'ENABLED' : 'Disabled'}\n` +
        `*Commands Available*:\n` +
        `• \`/pause\` - Pause auto-replies\n` +
        `• \`/resume\` - Resume auto-replies\n` +
        `• \`/deleted\` - View restored deleted messages\n` +
        `• \`/status\` - View bot configuration`;

      await sock.sendMessage(remoteJid, { text: statusText }, { quoted: msg });
    }
  }
}

module.exports = new MessageHandler();
