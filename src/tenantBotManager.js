const fs = require('fs');
const path = require('path');
const TenantBot = require('./tenantBot');
const { pool, ready } = require('./db');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');

class TenantBotManager {
  constructor() { this.bots = new Map(); }

  get(userId, account) {
    if (!this.bots.has(userId)) {
      if (!account) throw new Error('Account not found.');
      const bot = new TenantBot(account);
      bot.on('status', (status) => { if (this.onStatus) this.onStatus(userId, status); });
      this.bots.set(userId, bot);
    }
    return this.bots.get(userId);
  }

  async connect(userId, account, phoneNumber) {
    return this.get(userId, account).requestPairingCode(phoneNumber);
  }

  status(userId, account) {
    return this.get(userId, account).getStatus();
  }

  async disconnect(userId, account) {
    const bot = this.get(userId, account);
    const result = await bot.disconnect();
    this.bots.delete(userId);
    return result;
  }

  async startExistingSessions() {
    await ready;
    const result = await pool.query('SELECT id, email FROM tenant_accounts ORDER BY created_at');
    for (const account of result.rows) {
      const authDir = path.join(DATA_DIR, 'tenant_auth', account.id);
      if (!fs.existsSync(path.join(authDir, 'creds.json'))) continue;
      this.get(account.id, account).start().catch((err) => console.error('[tenant-bot-manager] startup failed:', err.message));
    }
  }

  async closeAll() {
    await Promise.all([...this.bots.values()].map((bot) => bot.close()));
  }
}

module.exports = new TenantBotManager();
