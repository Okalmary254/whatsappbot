const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const { pool, ready } = require('./db');
const aiService = require('./aiService');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const REPLY_COOLDOWN_MS = Math.max(1000, Number(process.env.SENDER_COOLDOWN_MS) || 5000);

class TenantBot extends EventEmitter {
  constructor(account) {
    super();
    this.account = account;
    this.userId = account.id;
    this.authFolder = path.join(DATA_DIR, 'tenant_auth', this.userId);
    this.sock = null;
    this.status = 'disconnected';
    this.pairingCode = null;
    this.userInfo = null;
    this.startPromise = null;
    this.reconnectTimer = null;
    this.stopping = false;
    this.lastReplyAt = new Map();
  }

  emitStatus() { this.emit('status', this.getStatus()); }

  getStatus() {
    return {
      status: this.status,
      pairingCode: this.pairingCode,
      user: this.userInfo ? { id: this.userInfo.id, name: this.userInfo.name } : null
    };
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    if (this.sock && this.status !== 'disconnected') return;
    this.stopping = false;
    this.startPromise = this._start();
    try { await this.startPromise; } finally { this.startPromise = null; }
  }

  async _start() {
    this.status = 'connecting';
    this.emitStatus();
    await ready;
    fs.mkdirSync(this.authFolder, { recursive: true, mode: 0o700 });
    const auth = await useMultiFileAuthState(this.authFolder);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      version, auth: auth.state, logger: pino({ level: 'silent' }),
      printQRInTerminal: false, browser: ['Whatsy', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false, syncFullHistory: false, retryRequestDelayMs: 2000
    });
    this.sock = sock;
    sock.ev.on('creds.update', auth.saveCreds);
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) { this.status = 'qr'; this.emitStatus(); }
      if (connection === 'open') {
        this.status = 'connected';
        this.userInfo = sock.user || null;
        this.pairingCode = null;
        await pool.query(
          'UPDATE tenant_accounts SET whatsapp_jid = $1, whatsapp_name = $2, updated_at = NOW() WHERE id = $3',
          [sock.user?.id || null, sock.user?.name || null, this.userId]
        );
        this.emitStatus();
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        this.status = 'disconnected';
        this.userInfo = null;
        this.emitStatus();
        if (!this.stopping && code !== DisconnectReason.loggedOut) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => this.start().catch((err) => console.error('[tenant-bot] reconnect failed:', err.message)), 3000);
        }
      }
    });
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) this.handleIncoming(msg).catch((err) => console.error('[tenant-bot] message processing failed:', err.message));
    });
  }

  async requestPairingCode(phoneNumber) {
    const number = String(phoneNumber || '').replace(/\D/g, '');
    if (number.length < 7 || number.length > 15) throw new Error('Enter a valid phone number with country code.');
    if (!this.sock) await this.start();
    if (!this.sock) throw new Error('WhatsApp is initializing. Wait a few seconds and retry.');
    if (this.status === 'connected') throw new Error('A WhatsApp account is already linked to this profile. Disconnect it before linking another number.');
    const code = await this.sock.requestPairingCode(number);
    this.pairingCode = code ? (code.match(/.{1,4}/g) || [code]).join('-') : code;
    this.emitStatus();
    return this.pairingCode;
  }

  async getConfig() {
    const result = await pool.query('SELECT config FROM tenant_bot_configs WHERE user_id = $1', [this.userId]);
    return result.rows[0]?.config || {
      bot: { autoReply: true, isPaused: false, ownerName: this.account.email.split('@')[0], ignoreGroups: true, minDelayMs: 1200, maxDelayMs: 2500 },
      ai: { provider: 'groq', groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b', systemInstructions: 'You are a concise, helpful WhatsApp AI assistant.' }
    };
  }

  async handleIncoming(msg) {
    const sock = this.sock;
    const jid = msg.key?.remoteJid;
    if (!sock || !jid || msg.key.fromMe || jid === 'status@broadcast' || jid.endsWith('@broadcast')) return;
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || '';
    if (!text.trim()) return;
    const config = await this.getConfig();
    const botConfig = config.bot || {};
    if (botConfig.autoReply === false || botConfig.isPaused) return;
    if (jid.endsWith('@g.us') && botConfig.ignoreGroups !== false) return;
    const sender = (msg.key.participant || jid).split('@')[0].split(':')[0];
    const now = Date.now();
    if (now - (this.lastReplyAt.get(sender) || 0) < REPLY_COOLDOWN_MS) return;
    this.lastReplyAt.set(sender, now);
    const messageId = msg.key.id || (now + '-' + Math.random().toString(36).slice(2));
    await pool.query(
      'INSERT INTO tenant_messages (user_id, message_id, jid, from_me, text, push_name, created_at) VALUES ($1, $2, $3, FALSE, $4, $5, NOW()) ON CONFLICT (user_id, message_id) DO NOTHING',
      [this.userId, messageId, jid, text.trim(), msg.pushName || sender]
    );
    const historyResult = await pool.query(
      'SELECT from_me, text FROM tenant_messages WHERE user_id = $1 AND jid = $2 ORDER BY created_at DESC LIMIT 12',
      [this.userId, jid]
    );
    const history = historyResult.rows.reverse().map((row) => ({ fromMe: row.from_me, text: row.text }));
    const minDelay = Math.max(0, Number(botConfig.minDelayMs) || 1200);
    const maxDelay = Math.max(minDelay, Number(botConfig.maxDelayMs) || 2500);
    await sock.sendPresenceUpdate('composing', jid).catch(() => {});
    const responsePromise = aiService.generateResponse(text.trim(), history, config);
    await new Promise((resolve) => setTimeout(resolve, minDelay + Math.floor(Math.random() * (maxDelay - minDelay + 1))));
    const response = await responsePromise;
    if (!response || this.sock !== sock || this.status !== 'connected') return;
    const sent = await sock.sendMessage(jid, { text: response });
    await pool.query(
      "INSERT INTO tenant_messages (user_id, message_id, jid, from_me, text, push_name, created_at) VALUES ($1, $2, $3, TRUE, $4, 'Whatsy', NOW()) ON CONFLICT (user_id, message_id) DO NOTHING",
      [this.userId, sent?.key?.id || (Date.now() + '-out'), jid, response]
    );
    this.emit('message', { jid, text: response, fromMe: true });
  }

  async disconnect() {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const sock = this.sock;
    this.sock = null;
    if (sock) {
      try { await sock.logout(); } catch (_) {}
      try { if (typeof sock.end === 'function') sock.end(undefined); } catch (_) {}
    }
    fs.rmSync(this.authFolder, { recursive: true, force: true });
    this.status = 'disconnected';
    this.pairingCode = null;
    this.userInfo = null;
    this.emitStatus();
    await pool.query('UPDATE tenant_accounts SET whatsapp_jid = NULL, whatsapp_name = NULL, updated_at = NOW() WHERE id = $1', [this.userId]);
    return { success: true };
  }

  async close() {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    const sock = this.sock;
    this.sock = null;
    if (sock && typeof sock.end === 'function') {
      try { sock.end(new Error('Whatsy is shutting down')); } catch (_) {}
    }
  }
}

module.exports = TenantBot;
