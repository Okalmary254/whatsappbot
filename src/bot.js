const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const EventEmitter = require('events');
const fs = require('fs');

const configManager = require('./configManager');
const logger = require('./logger');
const statusHandler = require('./statusHandler');
const messageHandler = require('./messageHandler');
const chatStore = require('./chatStore');

const AUTH_FOLDER = path.join(__dirname, '..', 'auth_info');

class WhatsAppBot extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'qr' | 'connecting' | 'connected'
    this.qrCode = null;
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.userInfo = null;
  }

  async start() {
    try {
      this.status = 'connecting';
      this.emitStatus('connecting');

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop')
      });

      this.sock.ev.on('creds.update', saveCreds);

      // Connection Updates (QR code, open, close)
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          this.status = 'qr';
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
          } catch (err) {
            console.error('Error generating QR Data URL:', err);
          }

          this.emitStatus('qr', { qr, qrDataUrl: this.qrDataUrl });
          
          console.log('\n--- SCAN THIS QR CODE ON WHATSAPP ---');
          qrcodeTerminal.generate(qr, { small: true });
          console.log('Or scan via Web Dashboard at http://localhost:3000\n');
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
          console.log('Connection closed. Reason:', lastDisconnect?.error?.message || 'Unknown');

          this.status = 'disconnected';
          this.qrCode = null;
          this.qrDataUrl = null;
          this.pairingCode = null;
          this.userInfo = null;
          this.emitStatus('disconnected');

          if (shouldReconnect) {
            logger.log('system', 'Reconnecting to WhatsApp...');
            setTimeout(() => this.start(), 3000);
          } else {
            logger.log('error', 'Logged out from WhatsApp. Clear auth_info folder to generate new QR or Pairing Code.');
          }
        } else if (connection === 'open') {
          this.status = 'connected';
          this.qrCode = null;
          this.qrDataUrl = null;
          this.pairingCode = null;
          this.userInfo = this.sock.user;

          console.log('✅ WhatsApp connected successfully!');
          logger.log('system', `WhatsApp connected as ${this.sock.user?.name || this.sock.user?.id}`);
          this.emitStatus('connected', { user: this.sock.user });
        }
      });

      // Handle Incoming Messages & Status Updates
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const currentConfig = configManager.getConfig();

        for (const msg of messages) {
          if (!msg.message) continue;

          // Check if message is a Status Update
          if (msg.key.remoteJid === 'status@broadcast') {
            await statusHandler.handleStatus(this.sock, msg, currentConfig);
          } else {
            // Check if message is a Protocol Message (Revoke / Deleted Message)
            const protocolMsg = msg.message?.protocolMessage;
            const isRevoke = protocolMsg && (
              protocolMsg.type === 0 || 
              protocolMsg.type === 1 || 
              protocolMsg.type === 'REVOKE'
            );

            if (isRevoke && protocolMsg.key) {
              const targetJid = protocolMsg.key.remoteJid || msg.key.remoteJid;
              const targetId = protocolMsg.key.id;

              if (targetJid && targetId) {
                const revokedResult = chatStore.handleRevokeMessage({
                  remoteJid: targetJid,
                  targetId: targetId,
                  revokeTimestamp: msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now()
                });

                const senderNumber = targetJid.split('@')[0];
                const pushName = msg.pushName || senderNumber;
                const restoredText = revokedResult?.message?.text || 'Unknown Content';

                logger.log('deleted_message', `🗑️ RESTORED DELETED MESSAGE from ${pushName} (${senderNumber}): "${restoredText}"`, {
                  pushName,
                  senderNumber,
                  remoteJid: targetJid,
                  targetId,
                  restoredText
                });
              }
              continue;
            }

            // Track message in ChatStore
            const remoteJid = msg.key.remoteJid;
            if (remoteJid) {
              const text = msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || 
                         msg.message?.imageMessage?.caption || 
                         msg.message?.videoMessage?.caption || 
                         (msg.message?.imageMessage ? '📷 Image' : (msg.message?.videoMessage ? '🎥 Video' : ''));

              if (text && text.trim() !== '') {
                const senderNumber = (msg.key.participant || remoteJid).split('@')[0];
                const pushName = msg.pushName || senderNumber;
                chatStore.addMessage({
                  jid: remoteJid,
                  id: msg.key.id,
                  fromMe: Boolean(msg.key.fromMe),
                  text: text,
                  pushName: pushName,
                  timestamp: msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now(),
                  isGroup: remoteJid.endsWith('@g.us')
                });
              }
            }

            await messageHandler.handleMessage(this.sock, msg, currentConfig);
          }
        }
      });

    } catch (err) {
      console.error('Failed to initialize WhatsApp Bot:', err);
      this.status = 'disconnected';
      this.emitStatus('disconnected');
    }
  }

  async requestPairingCode(phoneNumber) {
    if (!phoneNumber) {
      throw new Error('Phone number is required');
    }
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (!cleanNumber || cleanNumber.length < 7) {
      throw new Error('Invalid phone number format. Please include full country code (e.g. 254712345678 or 14155552671).');
    }

    if (!this.sock) {
      throw new Error('WhatsApp client is initializing. Please wait a moment and try again.');
    }

    try {
      const code = await this.sock.requestPairingCode(cleanNumber);
      const formattedCode = code ? (code.match(/.{1,4}/g)?.join('-') || code) : code;
      this.pairingCode = formattedCode;
      this.emitStatus(this.status, { pairingCode: formattedCode });
      logger.log('system', `Mobile pairing code requested for ${cleanNumber}: ${formattedCode}`);
      return formattedCode;
    } catch (err) {
      console.error('Error requesting pairing code from Baileys:', err);
      throw new Error(err.message || 'Failed to request pairing code from WhatsApp.');
    }
  }

  async resetSession() {
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (e) {}
      try {
        if (typeof this.sock.end === 'function') {
          this.sock.end(undefined);
        }
      } catch (e) {}
      this.sock = null;
    }

    if (fs.existsSync(AUTH_FOLDER)) {
      try {
        fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
      } catch (e) {
        console.error('Error clearing auth folder:', e);
      }
    }

    this.status = 'disconnected';
    this.qrCode = null;
    this.qrDataUrl = null;
    this.pairingCode = null;
    this.userInfo = null;
    this.emitStatus('disconnected');

    logger.log('system', 'Session reset by user. Restarting WhatsApp bot...');
    setTimeout(() => this.start(), 1500);
    return { success: true };
  }

  emitStatus(status, extra = {}) {
    this.emit('status', {
      status,
      qr: this.qrCode,
      qrDataUrl: this.qrDataUrl,
      pairingCode: this.pairingCode,
      user: this.userInfo,
      ...extra
    });
  }

  getStatus() {
    return {
      status: this.status,
      qr: this.qrCode,
      qrDataUrl: this.qrDataUrl,
      pairingCode: this.pairingCode,
      user: this.userInfo
    };
  }

  async sendDirectMessage(recipient, messageText) {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('WhatsApp is not connected. Please connect WhatsApp first.');
    }
    if (!recipient || !messageText) {
      throw new Error('Recipient phone number and message text are required.');
    }

    let jid = recipient.trim();
    if (!jid.includes('@')) {
      const cleanNumber = jid.replace(/[^0-9]/g, '');
      if (!cleanNumber || cleanNumber.length < 5) {
        throw new Error('Invalid recipient phone number. Include country code (e.g. 254712345678).');
      }
      jid = `${cleanNumber}@s.whatsapp.net`;
    }

    try {
      const sentMsg = await this.sock.sendMessage(jid, { text: messageText.trim() });
      const recipientNumber = jid.split('@')[0];

      chatStore.addMessage({
        jid: jid,
        id: sentMsg?.key?.id,
        fromMe: true,
        text: messageText.trim(),
        pushName: 'Me',
        timestamp: Date.now(),
        isGroup: jid.endsWith('@g.us')
      });

      logger.log('direct_message', `Sent direct message to ${recipientNumber}: "${messageText.trim()}"`, {
        pushName: recipientNumber,
        senderNumber: recipientNumber,
        remoteJid: jid,
        replyText: messageText.trim(),
        incomingText: '[Dashboard Direct Message]'
      });

      return {
        success: true,
        recipient: recipientNumber,
        messageId: sentMsg?.key?.id
      };
    } catch (err) {
      console.error('Error sending direct message:', err);
      throw new Error(err.message || 'Failed to send WhatsApp message.');
    }
  }

  async logout() {
    await this.resetSession();
  }
}

module.exports = new WhatsAppBot();

