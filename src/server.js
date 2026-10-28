const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const configManager = require('./configManager');
const logger = require('./logger');
const bot = require('./bot');
const chatStore = require('./chatStore');

const app = express();
const server = http.createServer(app);
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
const dashboardHost = process.env.HOST || '127.0.0.1';
const wss = new WebSocket.Server({ noServer: true });

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
}

function authorizeRequest(req) {
  if (dashboardPassword) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Basic ')) return false;
    let decoded;
    try { decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8'); } catch (_) { return false; }
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    const supplied = Buffer.from(decoded.slice(separator + 1));
    const expected = Buffer.from(dashboardPassword);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }
  const address = req.socket.remoteAddress || '';
  const isLoopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  return isLoopback && dashboardHost === '127.0.0.1';
}

app.use(express.json({ limit: '1mb' }));
require('./tenantPortal').mount(app);

app.use((req, res, next) => {
  if (!sameOrigin(req)) return res.status(403).send('Cross-origin requests are not allowed.');
  if (!authorizeRequest(req)) {
    if (!dashboardPassword && dashboardHost !== '127.0.0.1') {
      return res.status(503).send('Set DASHBOARD_PASSWORD before exposing the dashboard beyond localhost.');
    }
    res.set('WWW-Authenticate', 'Basic realm="WhatsApp Dashboard", charset="UTF-8"');
    return res.status(401).send('Authentication required.');
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Endpoints
app.get('/api/status', (req, res) => {
  const currentConfig = configManager.getConfig();
  res.json({
    ...bot.getStatus(),
    isPaused: currentConfig.bot?.isPaused || false
  });
});

function publicConfig() {
  const config = JSON.parse(JSON.stringify(configManager.getConfig()));
  if (config.ai) {
    delete config.ai.groqApiKey;
    delete config.ai.apiKey;
    delete config.ai.geminiApiKey;
  }
  return config;
}

app.get('/api/config', (req, res) => {
  res.json(publicConfig());
});

app.post('/api/config', (req, res) => {
  try {
    const updated = configManager.updateConfig(req.body);
    logger.log('system', 'Bot configuration updated via Web Dashboard');
    broadcast({ type: 'config_update', data: publicConfig() });
    res.json({ success: true, config: publicConfig() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pause', (req, res) => {
  try {
    const { isPaused } = req.body;
    const newState = configManager.setPaused(isPaused);
    logger.log('system', `Auto-reply state changed via API: ${newState ? 'PAUSED' : 'ACTIVE'}`);
    broadcast({ type: 'config_update', data: publicConfig() });
    res.json({ success: true, isPaused: newState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', (req, res) => {
  res.json(logger.getLogs());
});

app.post('/api/pairing-code', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    const pairingCode = await bot.requestPairingCode(phoneNumber);
    res.json({ success: true, pairingCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset-session', async (req, res) => {
  try {
    const result = await bot.resetSession();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/send-message', async (req, res) => {
  try {
    const { recipient, message } = req.body;
    if (!recipient || !message) {
      return res.status(400).json({ error: 'Recipient number and message text are required.' });
    }
    const result = await bot.sendDirectMessage(recipient, message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/contacts', (req, res) => {
  try {
    const logs = logger.getLogs()?.all || [];
    const contactsMap = {};

    logs.forEach(log => {
      if (log.details && log.details.senderNumber) {
        const num = log.details.senderNumber;
        if (!contactsMap[num]) {
          contactsMap[num] = {
            senderNumber: num,
            pushName: log.details.pushName || num,
            lastSeen: log.timestamp,
            statusViewCount: 0,
            messageCount: 0,
            lastStatusText: ''
          };
        }

        if (log.type === 'status_view') {
          contactsMap[num].statusViewCount++;
          if (log.details.statusText) contactsMap[num].lastStatusText = log.details.statusText;
        } else if (log.type === 'auto_reply' || log.type === 'incoming_message') {
          contactsMap[num].messageCount++;
        }

        if (log.timestamp > contactsMap[num].lastSeen) {
          contactsMap[num].lastSeen = log.timestamp;
          if (log.details.pushName && log.details.pushName !== num) {
            contactsMap[num].pushName = log.details.pushName;
          }
        }
      }
    });

    res.json(Object.values(contactsMap));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chats', (req, res) => {
  try {
    res.json(chatStore.getChats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/deleted-messages', (req, res) => {
  try {
    res.json(chatStore.getDeletedMessages());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chats/:jid/messages', (req, res) => {
  try {
    const { jid } = req.params;
    res.json(chatStore.getMessages(jid));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chats/:jid/messages', async (req, res) => {
  try {
    const { jid } = req.params;
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message text is required' });
    }
    const result = await bot.sendDirectMessage(jid, message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Broadcast event to WebSocket clients
function broadcast(message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Authenticate WebSocket upgrades as well as HTTP requests.
server.on('upgrade', (req, socket, head) => {
  if (!sameOrigin(req) || !authorizeRequest(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'init',
    status: {
      ...bot.getStatus(),
      isPaused: configManager.getConfig().bot?.isPaused || false
    },
    config: publicConfig(),
    logs: logger.getLogs(),
    chats: chatStore.getChats()
  }));
});

// Forward bot, logger & chat events to WebSocket clients
bot.on('status', (data) => {
  broadcast({ type: 'bot_status', data });
});

logger.on('newLog', (logEntry) => {
  broadcast({ type: 'new_log', data: logEntry });
});

chatStore.on('chatUpdated', (data) => {
  broadcast({ type: 'chat_update', data });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

function startServer() {
  server.listen(PORT, HOST, () => {
    console.log(`\n🚀 Web Dashboard running at: http://${HOST}:${PORT}`);
  });
}

module.exports = { startServer, server };
