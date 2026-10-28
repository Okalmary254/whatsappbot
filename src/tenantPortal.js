const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { pool, ready } = require('./db');
const botManager = require('./tenantBotManager');

const SESSION_COOKIE = 'whatsy_session';
const SESSION_DAYS = 30;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
let schemaReady;
const authAttempts = new Map();

function limitAuthAttempts(req, res, next) {
  const now = Date.now();
  const key = (req.ip || req.socket.remoteAddress || 'unknown') + ':' + req.path;
  const recent = (authAttempts.get(key) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
  if (recent.length >= 10) return sendError(res, 429, 'Too many attempts. Wait 15 minutes and try again.');
  recent.push(now);
  authAttempts.set(key, recent);
  if (authAttempts.size > 5000) {
    for (const [entry, times] of authAttempts) {
      if (!times.length || now - times[times.length - 1] > 15 * 60 * 1000) authAttempts.delete(entry);
    }
  }
  next();
}

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ready;
      await pool.query('CREATE TABLE IF NOT EXISTS tenant_accounts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, whatsapp_jid TEXT, whatsapp_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      await pool.query('CREATE TABLE IF NOT EXISTS tenant_sessions (token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES tenant_accounts(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      await pool.query('CREATE TABLE IF NOT EXISTS tenant_bot_configs (user_id UUID PRIMARY KEY REFERENCES tenant_accounts(id) ON DELETE CASCADE, config JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      await pool.query('CREATE TABLE IF NOT EXISTS tenant_messages (row_id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES tenant_accounts(id) ON DELETE CASCADE, message_id TEXT NOT NULL, jid TEXT NOT NULL, from_me BOOLEAN NOT NULL DEFAULT FALSE, text TEXT NOT NULL, push_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (user_id, message_id))');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_tenant_messages_user_jid_time ON tenant_messages (user_id, jid, created_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_tenant_sessions_expiry ON tenant_sessions (expires_at)');
      fs.mkdirSync(path.join(DATA_DIR, 'tenant_auth'), { recursive: true, mode: 0o700 });
    })();
  }
  return schemaReady;
}

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + hashPassword(password, salt);
}
function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) return false;
  const candidate = Buffer.from(hashPassword(password, parts[0]), 'hex');
  const expected = Buffer.from(parts[1], 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
  res.setHeader('Set-Cookie', SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (SESSION_DAYS * 86400) + (secure ? '; Secure' : ''));
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
  res.setHeader('Set-Cookie', SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : ''));
}
function getCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator >= 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
}
async function accountForRequest(req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || token.length > 256) return null;
  await ensureSchema();
  const result = await pool.query(
    'SELECT a.id, a.email, a.whatsapp_jid, a.whatsapp_name FROM tenant_sessions s JOIN tenant_accounts a ON a.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW()',
    [hashToken(token)]
  );
  return result.rows[0] || null;
}
function defaultConfig(email) {
  const ownerName = email.split('@')[0];
  return {
    bot: { autoReply: true, isPaused: false, ownerName, ignoreGroups: true, minDelayMs: 1200, maxDelayMs: 2500 },
    ai: { provider: 'groq', groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b', systemInstructions: 'You are a concise, helpful WhatsApp AI assistant for ' + ownerName + '. Reply naturally and accurately.' }
  };
}
async function saveConfig(userId, email, patch) {
  const result = await pool.query('SELECT config FROM tenant_bot_configs WHERE user_id = $1', [userId]);
  const current = result.rows[0]?.config || defaultConfig(email);
  const botPatch = patch.bot || {};
  const aiPatch = patch.ai || {};
  const next = {
    bot: {
      ...current.bot,
      autoReply: typeof botPatch.autoReply === 'boolean' ? botPatch.autoReply : current.bot.autoReply,
      isPaused: typeof botPatch.isPaused === 'boolean' ? botPatch.isPaused : current.bot.isPaused,
      ownerName: typeof botPatch.ownerName === 'string' ? botPatch.ownerName.trim().slice(0, 60) : current.bot.ownerName,
      ignoreGroups: typeof botPatch.ignoreGroups === 'boolean' ? botPatch.ignoreGroups : current.bot.ignoreGroups,
      minDelayMs: Math.min(10000, Math.max(0, Number(botPatch.minDelayMs ?? current.bot.minDelayMs) || 0)),
      maxDelayMs: Math.min(15000, Math.max(0, Number(botPatch.maxDelayMs ?? current.bot.maxDelayMs) || 0))
    },
    ai: {
      provider: 'groq',
      groqModel: process.env.GROQ_MODEL || current.ai.groqModel,
      systemInstructions: typeof aiPatch.systemInstructions === 'string' ? aiPatch.systemInstructions.trim().slice(0, 4000) : current.ai.systemInstructions
    }
  };
  if (next.bot.maxDelayMs < next.bot.minDelayMs) next.bot.maxDelayMs = next.bot.minDelayMs;
  await pool.query('INSERT INTO tenant_bot_configs (user_id, config, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (user_id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()', [userId, JSON.stringify(next)]);
  return next;
}
function sendError(res, status, message) { return res.status(status).json({ error: message }); }

function mount(app) {
  app.get('/', async (req, res) => {
    try {
      const account = await accountForRequest(req);
      return res.redirect(account ? '/portal' : '/login');
    } catch (_) {
      return res.redirect('/login');
    }
  });
  app.get(['/login', '/login/'], async (req, res) => {
    const account = await accountForRequest(req).catch(() => null);
    if (account) return res.redirect('/portal');
    return res.sendFile(path.join(__dirname, '..', 'public', 'auth.html'));
  });
  app.get(['/signup', '/signup/'], async (req, res) => {
    const account = await accountForRequest(req).catch(() => null);
    if (account) return res.redirect('/portal');
    return res.sendFile(path.join(__dirname, '..', 'public', 'auth.html'));
  });
  app.get(['/portal', '/portal/'], async (req, res) => {
    const account = await accountForRequest(req).catch(() => null);
    if (!account) return res.redirect('/login');
    return res.sendFile(path.join(__dirname, '..', 'public', 'portal.html'));
  });
  app.get('/portal.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'portal.js')));
  app.get('/auth.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'auth.js')));
  app.get('/portal.css', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'portal.css')));

  app.post('/api/tenant/signup', limitAuthAttempts, async (req, res) => {
    try {
      if (!sameOrigin(req)) return sendError(res, 403, 'Cross-origin request rejected.');
      await ensureSchema();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return sendError(res, 400, 'Enter a valid email address.');
      if (password.length < 10 || password.length > 256) return sendError(res, 400, 'Password must contain 10 to 256 characters.');
      const inserted = await pool.query('INSERT INTO tenant_accounts (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id, email', [email, makePasswordRecord(password)]);
      if (!inserted.rows[0]) return sendError(res, 409, 'An account with that email already exists.');
      const account = inserted.rows[0];
      await pool.query('INSERT INTO tenant_bot_configs (user_id, config) VALUES ($1, $2::jsonb)', [account.id, JSON.stringify(defaultConfig(email))]);
      const token = crypto.randomBytes(32).toString('base64url');
      await pool.query("INSERT INTO tenant_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')", [hashToken(token), account.id]);
      setSessionCookie(res, token);
      return res.status(201).json({ success: true, account: { id: account.id, email: account.email } });
    } catch (err) {
      console.error('[tenant-portal] signup failed:', err.message);
      return sendError(res, 500, 'Could not create your account. Check database configuration and try again.');
    }
  });

  app.post('/api/tenant/login', limitAuthAttempts, async (req, res) => {
    try {
      if (!sameOrigin(req)) return sendError(res, 403, 'Cross-origin request rejected.');
      await ensureSchema();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const result = await pool.query('SELECT id, email, password_hash FROM tenant_accounts WHERE email = $1', [email]);
      const account = result.rows[0];
      if (!account || !verifyPassword(password, account.password_hash)) return sendError(res, 401, 'Email or password is incorrect.');
      const token = crypto.randomBytes(32).toString('base64url');
      await pool.query("INSERT INTO tenant_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')", [hashToken(token), account.id]);
      setSessionCookie(res, token);
      return res.json({ success: true, account: { id: account.id, email: account.email } });
    } catch (err) {
      console.error('[tenant-portal] login failed:', err.message);
      return sendError(res, 500, 'Could not sign in. Check database configuration and try again.');
    }
  });

  app.post('/api/tenant/logout', async (req, res) => {
    try {
      if (!sameOrigin(req)) return sendError(res, 403, 'Cross-origin request rejected.');
      const token = getCookie(req, SESSION_COOKIE);
      if (token) {
        await ensureSchema();
        await pool.query('DELETE FROM tenant_sessions WHERE token_hash = $1', [hashToken(token)]);
      }
      clearSessionCookie(res);
      return res.json({ success: true });
    } catch (_) { return sendError(res, 500, 'Could not sign out.'); }
  });

  app.get('/api/tenant/me', async (req, res) => {
    try {
      const account = await accountForRequest(req);
      if (!account) return sendError(res, 401, 'Sign in to continue.');
      return res.json({ account: { id: account.id, email: account.email, whatsappJid: account.whatsapp_jid, whatsappName: account.whatsapp_name } });
    } catch (_) { return sendError(res, 500, 'Could not load account.'); }
  });

  app.get('/api/tenant/status', async (req, res) => {
    try {
      const account = await accountForRequest(req);
      if (!account) return sendError(res, 401, 'Sign in to continue.');
      return res.json({ ...botManager.status(account.id, account), account: { email: account.email, whatsappJid: account.whatsapp_jid, whatsappName: account.whatsapp_name } });
    } catch (err) { return sendError(res, 500, err.message || 'Could not load bot status.'); }
  });

  app.post('/api/tenant/pairing-code', async (req, res) => {
    try {
      if (!sameOrigin(req)) return sendError(res, 403, 'Cross-origin request rejected.');
      const account = await accountForRequest(req);
      if (!account) return sendError(res, 401, 'Sign in to continue.');
      const code = await botManager.connect(account.id, account, req.body?.phoneNumber);
      return res.json({ success: true, pairingCode: code });
    } catch (err) { return sendError(res, 400, err.message || 'Could not create pairing code.'); }
  });

  app.post('/api/tenant/disconnect', async (req, res) => {
    try {
      if (!sameOrigin(req)) return sendError(res, 403, 'Cross-origin request rejected.');
      const account = await accountForRequest(req);
      if (!account) return sendError(res, 401, 'Sign in to continue.');
      return res.json(await botManager.disconnect(account.id, account));
    } catch (err) { return sendError(res, 500, err.message || 'Could not disconnect WhatsApp.'); }
  });

  app.get('/api/tenant/config', async (req, res) => {
    try {
      const account = await accountForRequest(req);
      if (!account) return sendError(res, 401, 'Sign in to continue.');
      const result = await pool.query('SELECT config FROM tenant_bot_configs WHERE user_id = $1', [account.id]);
      return res.json(result.rows[0]?.config || defaultConfig(account.email));
    } catch (_) { return sendError(res, 500, 'Could not load settings.'); }
  });

  app.post('/api/tenant/config', async (req, res) => {
    try {
      if (!sameOrigin(req)) return sendError(res, 403, 'Cross-origin request rejected.');
      const account = await accountForRequest(req);
      if (!account) return sendError(res, 401, 'Sign in to continue.');
      return res.json({ success: true, config: await saveConfig(account.id, account.email, req.body || {}) });
    } catch (_) { return sendError(res, 500, 'Could not save settings.'); }
  });

  app.get('/api/tenant/messages', async (req, res) => {
    try {
      const account = await accountForRequest(req);
      if (!account) return sendError(res, 401, 'Sign in to continue.');
      const result = await pool.query('SELECT jid, from_me AS "fromMe", text, push_name AS "pushName", created_at AS timestamp FROM tenant_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [account.id]);
      return res.json(result.rows);
    } catch (_) { return sendError(res, 500, 'Could not load messages.'); }
  });
}

module.exports = { mount, ensureSchema };
