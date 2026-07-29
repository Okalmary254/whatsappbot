const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

const configManager = require('./configManager');
const logger = require('./logger');
const bot = require('./bot');
const chatStore = require('./chatStore');
const aiService = require('./aiService');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Endpoints
app.get('/api/status', (req, res) => {
  const currentConfig = configManager.getConfig();
  res.json({
    ...bot.getStatus(),
    isPaused: currentConfig.bot?.isPaused || false
  });
});

app.get('/api/config', (req, res) => {
  res.json(configManager.getConfig());
});

app.post('/api/config', (req, res) => {
  try {
    const updated = configManager.updateConfig(req.body);
    logger.log('system', 'Bot configuration updated via Web Dashboard');
    broadcast({ type: 'config_update', data: updated });
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pause', (req, res) => {
  try {
    const { isPaused } = req.body;
    const newState = configManager.setPaused(isPaused);
    logger.log('system', `Auto-reply state changed via API: ${newState ? 'PAUSED' : 'ACTIVE'}`);
    broadcast({ type: 'config_update', data: configManager.getConfig() });
    res.json({ success: true, isPaused: newState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status-digest', async (req, res) => {
  try {
    const todayStatuses = chatStore.getTodayStatusViews();
    const config = configManager.getConfig();
    const digestText = await aiService.generateStatusDigest(todayStatuses, config);
    res.json({
      success: true,
      count: todayStatuses.length,
      digest: digestText,
      statuses: todayStatuses
    });
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

// WebSocket Connection Handler
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'init',
    status: {
      ...bot.getStatus(),
      isPaused: configManager.getConfig().bot?.isPaused || false
    },
    config: configManager.getConfig(),
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

function startServer() {
  server.listen(PORT, () => {
    console.log(`\n🚀 Web Dashboard running at: http://localhost:${PORT}`);
  });
}

module.exports = { startServer, server };
