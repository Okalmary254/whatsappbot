let currentActiveChatJid = null;
let allChatsList = [];

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initMethodTabs();
  initWebSocket();
  initFormListeners();
  initPairingForm();
  initDirectMessageForm();
  initChatUI();
  loadInitialData();
  loadContactsData();
  loadChatsData();
  loadDeletedMessagesData();
  if (window.lucide) { lucide.createIcons(); }
});

// Tab Switcher
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      document.getElementById(targetId).classList.add('active');
    });
  });
}

// Connection Method Switcher (QR Code vs Mobile Phone)
function initMethodTabs() {
  const btnQr = document.getElementById('btnMethodQr');
  const btnMobile = document.getElementById('btnMethodMobile');
  const viewQr = document.getElementById('methodQrContainer');
  const viewMobile = document.getElementById('methodMobileContainer');

  if (btnQr && btnMobile) {
    btnQr.addEventListener('click', () => {
      btnQr.classList.add('active');
      btnMobile.classList.remove('active');
      viewQr.classList.remove('hidden');
      viewQr.classList.add('active');
      viewMobile.classList.add('hidden');
      viewMobile.classList.remove('active');
    });

    btnMobile.addEventListener('click', () => {
      btnMobile.classList.add('active');
      btnQr.classList.remove('active');
      viewMobile.classList.remove('hidden');
      viewMobile.classList.add('active');
      viewQr.classList.add('hidden');
      viewQr.classList.remove('active');
    });
  }
}

// WebSocket Connection
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'init') {
        updateBotStatus(msg.status);
        applyConfig(msg.config);
        renderLogs(msg.logs);
        if (msg.chats) {
          allChatsList = msg.chats;
          renderChatList(allChatsList);
        }
      } else if (msg.type === 'bot_status') {
        updateBotStatus(msg.data);
      } else if (msg.type === 'config_update') {
        applyConfig(msg.data);
      } else if (msg.type === 'new_log') {
        appendLog(msg.data);
      } else if (msg.type === 'chat_update') {
        handleChatUpdateWS(msg.data);
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e);
    }
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 3000);
  };
}

// Fetch Initial Data
async function loadInitialData() {
  try {
    const statusRes = await fetch('/api/status');
    const statusData = await statusRes.json();
    updateBotStatus(statusData);

    const configRes = await fetch('/api/config');
    currentConfig = await configRes.json();
    applyConfig(currentConfig);

    const logsRes = await fetch('/api/logs');
    const logsData = await logsRes.json();
    renderLogs(logsData);
  } catch (err) {
    console.error('Failed to load initial data:', err);
  }
}

// Update Connection Badge & QR / Pairing Section
function updateBotStatus(statusObj) {
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const qrSection = document.getElementById('qrSection');
  const connectedCard = document.getElementById('connectedCard');
  const userInfoText = document.getElementById('userInfoText');
  const qrImg = document.getElementById('qrImg');
  const qrCanvas = document.getElementById('qrCanvas');
  const qrPlaceholder = document.getElementById('qrPlaceholder');

  const { status, qr, qrDataUrl, pairingCode, user } = statusObj;

  statusBadge.className = 'status-badge';

  if (status === 'connected') {
    statusBadge.classList.add('status-connected');
    statusText.innerText = 'Connected';
    qrSection.classList.add('hidden');
    if (connectedCard) connectedCard.classList.remove('hidden');

    if (user && userInfoText) {
      const userName = user.name || user.id.split(':')[0];
      userInfoText.innerText = `Connected as ${userName} (+${user.id.split('@')[0].split(':')[0]})`;
    }
  } else {
    // Show Link/Scan card if not connected
    if (connectedCard) connectedCard.classList.add('hidden');
    qrSection.classList.remove('hidden');

    if (status === 'qr' || qr || qrDataUrl) {
      statusBadge.classList.add('status-qr');
      statusText.innerText = 'Action Required (Scan / Link)';
    } else if (status === 'connecting') {
      statusBadge.classList.add('status-disconnected');
      statusText.innerText = 'Connecting...';
    } else {
      statusBadge.classList.add('status-disconnected');
      statusText.innerText = 'Disconnected';
    }

    // Render QR Code Image or Canvas
    if (qrDataUrl) {
      qrImg.src = qrDataUrl;
      qrImg.classList.remove('hidden');
      if (qrCanvas) qrCanvas.classList.add('hidden');
      if (qrPlaceholder) qrPlaceholder.classList.add('hidden');
    } else if (qr && window.QRCode) {
      QRCode.toCanvas(qrCanvas, qr, { width: 220 }, (err) => {
        if (err) console.error(err);
        else {
          qrCanvas.classList.remove('hidden');
          qrImg.classList.add('hidden');
          if (qrPlaceholder) qrPlaceholder.classList.add('hidden');
        }
      });
    } else if (qr) {
      if (qrPlaceholder) {
        qrPlaceholder.innerText = 'Generating QR code image...';
        qrPlaceholder.classList.remove('hidden');
      }
    } else {
      if (qrPlaceholder) {
        qrPlaceholder.innerText = 'Waiting for WhatsApp connection...';
        qrPlaceholder.classList.remove('hidden');
      }
      qrImg.classList.add('hidden');
      if (qrCanvas) qrCanvas.classList.add('hidden');
    }

    // Render Pairing Code if present
    if (pairingCode) {
      const codeVal = document.getElementById('pairingCodeValue');
      const codeRes = document.getElementById('pairingCodeResult');
      if (codeVal && codeRes) {
        codeVal.innerText = pairingCode;
        codeRes.classList.remove('hidden');
      }
    }
  }
}

// Mobile Pairing & Reset Handlers
function initPairingForm() {
  const pairingForm = document.getElementById('pairingForm');
  const mobileNumberInput = document.getElementById('mobileNumberInput');
  const requestPairingBtn = document.getElementById('requestPairingBtn');
  const pairingCodeResult = document.getElementById('pairingCodeResult');
  const pairingCodeValue = document.getElementById('pairingCodeValue');
  const copyPairingCodeBtn = document.getElementById('copyPairingCodeBtn');
  const resetSessionBtn = document.getElementById('resetSessionBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  if (pairingForm) {
    pairingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawNumber = mobileNumberInput.value.trim();
      if (!rawNumber) return;

      requestPairingBtn.disabled = true;
      requestPairingBtn.innerHTML = '<span>⏳</span> Sending Code Request...';

      try {
        const res = await fetch('/api/pairing-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: rawNumber })
        });

        const data = await res.json();
        if (data.success && data.pairingCode) {
          pairingCodeValue.innerText = data.pairingCode;
          pairingCodeResult.classList.remove('hidden');
        } else {
          alert('Error: ' + (data.error || 'Failed to request pairing code. Ensure valid phone number with country code.'));
        }
      } catch (err) {
        console.error('Pairing code error:', err);
        alert('Failed to connect to server.');
      } finally {
        requestPairingBtn.disabled = false;
        requestPairingBtn.innerHTML = '<span>⚡</span> Send Code';
      }
    });
  }

  if (copyPairingCodeBtn) {
    copyPairingCodeBtn.addEventListener('click', () => {
      const codeText = pairingCodeValue.innerText.replace(/[^A-Z0-9-]/gi, '');
      if (codeText) {
        navigator.clipboard.writeText(codeText);
        copyPairingCodeBtn.innerText = '✅ Copied!';
        setTimeout(() => {
          copyPairingCodeBtn.innerText = '📋 Copy';
        }, 2000);
      }
    });
  }

  async function handleResetSession() {
    if (!confirm('Are you sure you want to reset session and clear current connection?')) {
      return;
    }
    try {
      const res = await fetch('/api/reset-session', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('Session cleared. Restarting bot connection...');
        if (pairingCodeResult) pairingCodeResult.classList.add('hidden');
      }
    } catch (err) {
      console.error('Reset error:', err);
      alert('Error resetting session.');
    }
  }

  if (resetSessionBtn) resetSessionBtn.addEventListener('click', handleResetSession);
  if (logoutBtn) logoutBtn.addEventListener('click', handleResetSession);
}

// Populate Settings & Rules from Config
function applyConfig(config) {
  if (!config) return;
  currentConfig = config;
  currentRules = config.rules || [];

  const toggleStatus = document.getElementById('toggleAutoStatus');
  const toggleReply = document.getElementById('toggleAutoReply');
  const replyMode = document.getElementById('replyMode');
  const geminiModel = document.getElementById('geminiModel') || document.getElementById('aiModel');
  const apiKey = document.getElementById('geminiApiKey');
  const instructions = document.getElementById('systemInstructions');
  const delayInput = document.getElementById('naturalDelayMs') || document.getElementById('naturalDelay');
  const ignoreGroups = document.getElementById('ignoreGroups');

  if (toggleStatus) toggleStatus.checked = config.bot.autoViewStatus ?? true;
  if (toggleReply) toggleReply.checked = config.bot.autoReply ?? true;
  if (replyMode) replyMode.value = config.bot.replyMode || 'ai';
  if (geminiModel) geminiModel.value = config.ai.model || 'gemini-2.0-flash';
  if (apiKey) apiKey.value = config.ai.geminiApiKey || '';
  if (instructions) instructions.value = config.ai.systemInstructions || '';
  if (delayInput) delayInput.value = config.bot.naturalDelayMs || 2500;
  if (ignoreGroups) ignoreGroups.checked = config.bot.ignoreGroups ?? true;

  renderRules();
}

// Quick Toggles & Forms
function initFormListeners() {
  const toggleStatus = document.getElementById('toggleAutoStatus');
  const toggleReply = document.getElementById('toggleAutoReply');
  const aiForm = document.getElementById('aiConfigForm');
  const addRuleBtn = document.getElementById('addRuleBtn');
  const saveRulesBtn = document.getElementById('saveRulesBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');

  if (toggleStatus) {
    toggleStatus.addEventListener('change', (e) => {
      saveBotToggle({ autoViewStatus: e.target.checked });
    });
  }

  if (toggleReply) {
    toggleReply.addEventListener('change', (e) => {
      saveBotToggle({ autoReply: e.target.checked });
    });
  }

  if (aiForm) {
    aiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const modelVal = (document.getElementById('geminiModel') || document.getElementById('aiModel'))?.value || 'gemini-2.0-flash';
      const delayVal = parseInt((document.getElementById('naturalDelayMs') || document.getElementById('naturalDelay'))?.value, 10) || 2000;

      const updatedConfig = {
        bot: {
          ...currentConfig.bot,
          replyMode: document.getElementById('replyMode').value,
          naturalDelayMs: delayVal,
          ignoreGroups: document.getElementById('ignoreGroups').checked
        },
        ai: {
          ...currentConfig.ai,
          model: modelVal,
          geminiApiKey: document.getElementById('geminiApiKey').value.trim(),
          systemInstructions: document.getElementById('systemInstructions').value.trim()
        }
      };

      await saveConfig(updatedConfig);
      alert('AI Instructions and Settings saved successfully!');
    });
  }

  if (addRuleBtn) {
    addRuleBtn.addEventListener('click', () => {
      currentRules.push({
        id: Date.now().toString(),
        trigger: '',
        type: 'contains',
        response: ''
      });
      renderRules();
    });
  }

  if (saveRulesBtn) {
    saveRulesBtn.addEventListener('click', async () => {
      readRulesFromDOM();
      await saveConfig({ rules: currentRules });
      alert('Keyword Rules saved successfully!');
    });
  }

  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', () => {
      const consoleBox = document.getElementById('consoleLogs');
      if (consoleBox) consoleBox.innerHTML = '';
    });
  }
}

async function saveBotToggle(toggleObj) {
  const updated = {
    ...currentConfig,
    bot: { ...currentConfig.bot, ...toggleObj }
  };
  await saveConfig(updated);
}

async function saveConfig(newConfigData) {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfigData)
    });
    const data = await res.json();
    if (data.config) currentConfig = data.config;
  } catch (err) {
    console.error('Error saving config:', err);
  }
}

// Rules Editor UI
function renderRules() {
  const container = document.getElementById('rulesContainer') || document.getElementById('rulesList');
  if (!container) return;
  container.innerHTML = '';

  if (!currentRules || currentRules.length === 0) {
    container.innerHTML = '<div class="card-desc">No keyword rules defined yet. Click "+ Add Rule" to create one.</div>';
    return;
  }

  currentRules.forEach((rule, idx) => {
    const div = document.createElement('div');
    div.className = 'rule-item';
    div.innerHTML = `
      <input type="text" class="form-control rule-trigger" value="${escapeHtml(rule.trigger)}" placeholder="Trigger keyword (e.g. price)">
      <select class="form-control rule-type">
        <option value="contains" ${rule.type === 'contains' ? 'selected' : ''}>Contains</option>
        <option value="exact" ${rule.type === 'exact' ? 'selected' : ''}>Exact match</option>
        <option value="startsWith" ${rule.type === 'startsWith' ? 'selected' : ''}>Starts with</option>
      </select>
      <input type="text" class="form-control rule-response" value="${escapeHtml(rule.response)}" placeholder="Response message text">
      <button type="button" class="btn btn-sm btn-danger remove-rule-btn" data-idx="${idx}"><i data-lucide="trash-2"></i></button>
    `;
    container.appendChild(div);
  });

  document.querySelectorAll('.remove-rule-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetBtn = e.target.closest('.remove-rule-btn');
      if (targetBtn) {
        const idx = parseInt(targetBtn.dataset.idx, 10);
        currentRules.splice(idx, 1);
        renderRules();
      }
    });
  });

  if (window.lucide) { lucide.createIcons(); }
}

function readRulesFromDOM() {
  const items = document.querySelectorAll('.rule-item');
  const updatedRules = [];
  items.forEach((item, idx) => {
    const trigger = item.querySelector('.rule-trigger').value.trim();
    const type = item.querySelector('.rule-type').value;
    const response = item.querySelector('.rule-response').value.trim();

    if (trigger && response) {
      updatedRules.push({
        id: currentRules[idx]?.id || Date.now().toString() + idx,
        trigger,
        type,
        response
      });
    }
  });
  currentRules = updatedRules;
}

// Render Initial Activity Logs
function renderLogs(logsObj) {
  if (!logsObj) return;

  const statusFeed = document.getElementById('statusFeed');
  const chatFeed = document.getElementById('chatFeed');
  const consoleBox = document.getElementById('consoleLogs');

  if (statusFeed) statusFeed.innerHTML = '';
  if (chatFeed) chatFeed.innerHTML = '';
  if (consoleBox) consoleBox.innerHTML = '';

  let statusCount = 0;
  let replyCount = 0;

  const allLogs = logsObj.all || [];

  [...allLogs].reverse().forEach(log => {
    appendLogToConsole(log);
    if (log.type === 'status_view') {
      appendStatusFeedItem(log);
      statusCount++;
    } else if (log.type === 'auto_reply' || log.type === 'direct_message') {
      appendChatFeedItem(log);
      replyCount++;
    }
  });

  if (statusFeed && statusFeed.children.length === 0) {
    statusFeed.innerHTML = '<div class="empty-feed">No status stories viewed yet</div>';
  }
  if (chatFeed && chatFeed.children.length === 0) {
    chatFeed.innerHTML = '<div class="empty-feed">No automated replies sent yet</div>';
  }

  const statusCountEl = document.getElementById('statusViewCount');
  const replyCountEl = document.getElementById('replyCount');
  if (statusCountEl) statusCountEl.innerText = statusCount;
  if (replyCountEl) replyCountEl.innerText = replyCount;
}

function appendLog(log) {
  appendLogToConsole(log);

  if (log.type === 'status_view') {
    appendStatusFeedItem(log);
    const countEl = document.getElementById('statusViewCount');
    if (countEl) countEl.innerText = parseInt(countEl.innerText || 0, 10) + 1;
    loadContactsData();
  } else if (log.type === 'auto_reply' || log.type === 'direct_message') {
    appendChatFeedItem(log);
    const countEl = document.getElementById('replyCount');
    if (countEl) countEl.innerText = parseInt(countEl.innerText || 0, 10) + 1;
    loadContactsData();
  } else if (log.type === 'deleted_message') {
    loadDeletedMessagesData();
  }
}

function appendStatusFeedItem(log) {
  const feed = document.getElementById('statusFeed');
  if (!feed) return;
  const empty = feed.querySelector('.empty-feed');
  if (empty) empty.remove();

  const timeStr = new Date(log.timestamp).toLocaleTimeString();
  const phone = log.details?.senderNumber || '';
  const pushName = log.details?.pushName || 'Contact';

  const div = document.createElement('div');
  div.className = 'feed-item';
  div.innerHTML = `
    <div class="feed-item-header">
      <span><i data-lucide="eye"></i> ${escapeHtml(pushName)} ${phone ? `<span class="contact-phone-tag"><i data-lucide="phone"></i> +${escapeHtml(phone)}</span>` : ''}</span>
      <span class="feed-time">${timeStr}</span>
    </div>
    <div>${escapeHtml(log.message)}</div>
    ${log.details?.statusText ? `<div class="form-hint">Caption: "${escapeHtml(log.details.statusText)}"</div>` : ''}
    ${phone ? `<div style="margin-top: 8px;"><button type="button" class="btn btn-sm btn-secondary" onclick="prefillQuickMessage('${escapeHtml(phone)}')"><i data-lucide="message-square"></i> Message +${escapeHtml(phone)}</button></div>` : ''}
  `;
  feed.insertBefore(div, feed.firstChild);
  if (window.lucide) { lucide.createIcons(); }
}

function appendChatFeedItem(log) {
  const feed = document.getElementById('chatFeed');
  if (!feed) return;
  const empty = feed.querySelector('.empty-feed');
  if (empty) empty.remove();

  const timeStr = new Date(log.timestamp).toLocaleTimeString();
  const phone = log.details?.senderNumber || '';
  const pushName = log.details?.pushName || 'Contact';

  const div = document.createElement('div');
  div.className = 'feed-item';
  div.innerHTML = `
    <div class="feed-item-header">
      <span><i data-lucide="message-square"></i> ${escapeHtml(pushName)} ${phone ? `<span class="contact-phone-tag"><i data-lucide="phone"></i> +${escapeHtml(phone)}</span>` : ''}</span>
      <span class="feed-time">${timeStr}</span>
    </div>
    <div style="color: var(--text-muted); margin-bottom: 4px;">In: "${escapeHtml(log.details?.incomingText || '')}"</div>
    <div style="color: var(--accent-green);">Out: "${escapeHtml(log.details?.replyText || '')}"</div>
  `;
  feed.insertBefore(div, feed.firstChild);
  if (window.lucide) { lucide.createIcons(); }
}

function initDirectMessageForm() {
  const form = document.getElementById('directMessageForm');
  const recipientInput = document.getElementById('directRecipientInput');
  const msgTextInput = document.getElementById('directMessageText');
  const sendBtn = document.getElementById('sendDirectMsgBtn');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const recipient = recipientInput.value.trim();
      const message = msgTextInput.value.trim();

      if (!recipient || !message) return;

      sendBtn.disabled = true;
      sendBtn.innerHTML = '<span>⏳</span> Sending Message...';

      try {
        const res = await fetch('/api/send-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient, message })
        });

        const data = await res.json();
        if (data.success) {
          alert(`✅ Message successfully sent to ${data.recipient || recipient}!`);
          msgTextInput.value = '';
          loadContactsData();
        } else {
          alert('Error sending message: ' + (data.error || 'Failed to send message. Ensure WhatsApp is connected.'));
        }
      } catch (err) {
        console.error('Error sending message:', err);
        alert('Failed to connect to server to send message.');
      } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<span>📤 Send Custom Message</span>';
      }
    });
  }
}

function initChatUI() {
  const searchInput = document.getElementById('chatSearchInput');
  const chatSendForm = document.getElementById('chatSendForm');
  const chatBackBtn = document.getElementById('chatBackBtn');

  if (chatBackBtn) {
    chatBackBtn.addEventListener('click', () => {
      document.querySelector('.chat-app-card')?.classList.remove('mobile-chat-open');
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      if (!term) {
        renderChatList(allChatsList);
      } else {
        const filtered = allChatsList.filter(c => 
          (c.name && c.name.toLowerCase().includes(term)) || 
          (c.phoneNumber && c.phoneNumber.includes(term)) ||
          (c.lastMessage && c.lastMessage.toLowerCase().includes(term))
        );
        renderChatList(filtered);
      }
    });
  }

  if (chatSendForm) {
    chatSendForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inputText = document.getElementById('chatInputText');
      const sendBtn = document.getElementById('chatSendBtn');
      if (!currentActiveChatJid || !inputText) return;

      const messageText = inputText.value.trim();
      if (!messageText) return;

      sendBtn.disabled = true;

      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(currentActiveChatJid)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: messageText })
        });
        const data = await res.json();
        if (data.success) {
          inputText.value = '';
          appendChatMessageBubble({
            id: data.messageId || Date.now().toString(),
            fromMe: true,
            text: messageText,
            timestamp: Date.now(),
            pushName: 'Me'
          });
          loadChatsData();
        } else {
          alert('Failed to send message: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        console.error('Error sending chat message:', err);
        alert('Error sending message.');
      } finally {
        sendBtn.disabled = false;
      }
    });
  }
}

async function loadChatsData() {
  try {
    const res = await fetch('/api/chats');
    allChatsList = await res.json();
    renderChatList(allChatsList);
  } catch (err) {
    console.error('Error loading chats:', err);
  }
}

function renderChatList(chats) {
  const container = document.getElementById('activeChatList');
  const countBadge = document.getElementById('chatCountBadge');
  if (!container) return;

  if (countBadge) countBadge.innerText = `${chats ? chats.length : 0} Chats`;

  if (!chats || chats.length === 0) {
    container.innerHTML = '<div class="empty-feed">No active conversations yet. Messages received or sent will appear here.</div>';
    return;
  }

  container.innerHTML = '';
  chats.forEach(chat => {
    const div = document.createElement('div');
    div.className = `chat-item ${currentActiveChatJid === chat.jid ? 'active' : ''}`;
    div.dataset.jid = chat.jid;
    
    const timeStr = new Date(chat.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const initial = (chat.name || chat.phoneNumber || 'W').charAt(0).toUpperCase();

    div.innerHTML = `
      <div class="chat-item-avatar">${escapeHtml(initial)}</div>
      <div class="chat-item-details">
        <div class="chat-item-top">
          <span class="chat-item-name">${escapeHtml(chat.name || chat.phoneNumber)}</span>
          <span class="chat-item-time">${timeStr}</span>
        </div>
        <div class="chat-item-bottom">
          <span class="chat-item-snippet">${escapeHtml(chat.lastMessage || '')}</span>
          ${chat.unreadCount > 0 ? `<span class="unread-pill">${chat.unreadCount}</span>` : ''}
        </div>
      </div>
    `;

    div.addEventListener('click', () => selectChat(chat.jid, chat));
    container.appendChild(div);
  });
}

async function selectChat(jid, chatObj) {
  currentActiveChatJid = jid;
  document.querySelector('.chat-app-card')?.classList.add('mobile-chat-open');

  document.querySelectorAll('.chat-item').forEach(el => {
    if (el.dataset.jid === jid) el.classList.add('active');
    else el.classList.remove('active');
  });

  const emptyState = document.getElementById('chatEmptyState');
  const activeView = document.getElementById('chatActiveView');
  const nameEl = document.getElementById('activeChatName');
  const phoneEl = document.getElementById('activeChatPhone');
  const avatarEl = document.getElementById('activeChatAvatar');

  if (emptyState) emptyState.classList.add('hidden');
  if (activeView) activeView.classList.remove('hidden');

  const chatName = chatObj?.name || jid.split('@')[0];
  const chatPhone = chatObj?.phoneNumber || jid.split('@')[0];

  if (nameEl) nameEl.innerText = chatName;
  if (phoneEl) phoneEl.innerText = `📞 +${chatPhone}`;
  if (avatarEl) avatarEl.innerText = chatName.charAt(0).toUpperCase();

  try {
    const res = await fetch(`/api/chats/${encodeURIComponent(jid)}/messages`);
    const messages = await res.json();
    renderChatMessages(messages);
  } catch (err) {
    console.error('Error fetching chat messages:', err);
  }
}

function renderChatMessages(messages) {
  const box = document.getElementById('chatMessagesBox');
  if (!box) return;

  box.innerHTML = '';
  if (!messages || messages.length === 0) {
    box.innerHTML = '<div class="empty-feed">No messages in this chat yet. Type a message below to start chatting!</div>';
    return;
  }

  messages.forEach(msg => {
    appendChatMessageBubble(msg, false);
  });

  box.scrollTop = box.scrollHeight;
}

function appendChatMessageBubble(msg, scroll = true) {
  const box = document.getElementById('chatMessagesBox');
  if (!box) return;

  const empty = box.querySelector('.empty-feed');
  if (empty) empty.remove();

  const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isDeleted = Boolean(msg.isDeleted);

  const div = document.createElement('div');
  div.className = `msg-bubble ${msg.fromMe ? 'msg-outgoing' : 'msg-incoming'} ${isDeleted ? 'deleted-revoked' : ''}`;
  
  div.innerHTML = `
    ${isDeleted ? `<div class="deleted-badge">🗑️ DELETED BY SENDER (RESTORED)</div>` : ''}
    <div style="${isDeleted ? 'color: #fca5a5; font-weight: 500;' : ''}">${escapeHtml(msg.text)}</div>
    <div class="msg-meta">
      <span>${timeStr}</span>
      ${isDeleted ? `<span style="color: #ef4444; margin-left: 4px;">• Deleted</span>` : ''}
    </div>
  `;

  box.appendChild(div);
  if (scroll) {
    box.scrollTop = box.scrollHeight;
  }
}

function handleChatUpdateWS(data) {
  if (!data) return;
  const { chat, message } = data;

  loadChatsData();

  if (currentActiveChatJid && chat && chat.jid === currentActiveChatJid && message) {
    appendChatMessageBubble(message, true);
  }

  if (message && message.isDeleted) {
    loadDeletedMessagesData();
  }
}

async function loadDeletedMessagesData() {
  try {
    const res = await fetch('/api/deleted-messages');
    const deletedMsgs = await res.json();
    renderDeletedMessagesVault(deletedMsgs);
  } catch (err) {
    console.error('Error loading deleted messages:', err);
  }
}

function renderDeletedMessagesVault(messages) {
  const container = document.getElementById('deletedMessagesVaultList');
  const countBadge = document.getElementById('deletedCountBadge');
  if (!container) return;

  if (countBadge) countBadge.innerText = `${messages ? messages.length : 0} Restored`;

  if (!messages || messages.length === 0) {
    container.innerHTML = '<div class="empty-feed">No deleted messages captured yet</div>';
    return;
  }

  container.innerHTML = '';
  messages.forEach(msg => {
    const div = document.createElement('div');
    div.className = 'feed-item';
    const timeStr = new Date(msg.deletedAt || msg.timestamp).toLocaleTimeString();
    const phone = msg.phoneNumber || msg.jid.split('@')[0];
    const pushName = msg.pushName || phone;

    div.innerHTML = `
      <div class="feed-item-header">
        <span><i data-lucide="trash-2" style="color: #f87171;"></i> <strong style="color: #f87171;">${escapeHtml(pushName)}</strong> <span class="contact-phone-tag"><i data-lucide="phone"></i> +${escapeHtml(phone)}</span></span>
        <span class="feed-time">${timeStr}</span>
      </div>
      <div style="color: #fca5a5; font-weight: 600; margin-top: 4px; background: rgba(239,68,68,0.1); padding: 8px 12px; border-radius: 6px; border: 1px dashed rgba(239,68,68,0.3);">
        "${escapeHtml(msg.text)}"
      </div>
      <div style="margin-top: 8px;">
        <button type="button" class="btn btn-sm btn-secondary" onclick="prefillQuickMessage('${escapeHtml(phone)}')">
          <i data-lucide="message-square"></i> Open Chat with +${escapeHtml(phone)}
        </button>
      </div>
    `;

    container.appendChild(div);
  });
  if (window.lucide) { lucide.createIcons(); }
}

function prefillQuickMessage(phoneNumber) {
  // Open Chat tab or prefill quick message
  const chatTabBtn = document.querySelector('.tab-btn[data-tab="tab-chat"]');
  if (chatTabBtn) chatTabBtn.click();

  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  const jid = `${cleanPhone}@s.whatsapp.net`;

  const existing = allChatsList.find(c => c.jid === jid || c.phoneNumber === cleanPhone);
  if (existing) {
    selectChat(existing.jid, existing);
  } else {
    // If new contact, select directly
    selectChat(jid, { jid, name: cleanPhone, phoneNumber: cleanPhone });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}
