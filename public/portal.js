const $ = (id) => document.getElementById(id);
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { window.location.assign('/login'); throw new Error('Your session expired. Sign in again.'); }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}
async function loadAccount() {
  const data = await api('/api/tenant/me');
  $('accountEmail').textContent = data.account.email;
  if (data.account.whatsappJid) $('phoneNumber').value = '+' + data.account.whatsappJid.split('@')[0].split(':')[0].replace(/\D/g, '');
}
async function loadStatus() {
  const status = await api('/api/tenant/status');
  const connected = status.status === 'connected';
  $('statusLabel').textContent = connected ? 'WhatsApp connected' : status.status === 'connecting' ? 'Connecting…' : status.status === 'qr' ? 'Waiting for phone link' : 'Not connected';
  $('statusDot').classList.toggle('connected', connected);
  $('disconnectButton').classList.toggle('hidden', !connected);
  if (connected && status.account?.whatsappName) $('statusLabel').textContent = 'Connected as ' + status.account.whatsappName;
}
async function loadSettings() {
  const config = await api('/api/tenant/config');
  const bot = config.bot || {}; const ai = config.ai || {};
  $('autoReply').checked = bot.autoReply !== false;
  $('isPaused').checked = Boolean(bot.isPaused);
  $('replyInGroups').checked = bot.ignoreGroups === false;
  $('ownerName').value = bot.ownerName || '';
  $('systemInstructions').value = ai.systemInstructions || '';
  $('minDelayMs').value = Number(bot.minDelayMs ?? 1200);
  $('maxDelayMs').value = Number(bot.maxDelayMs ?? 2500);
}
async function loadMessages() {
  const messages = await api('/api/tenant/messages'); const list = $('messagesList');
  if (!messages.length) { list.innerHTML = '<p class="muted">No messages recorded yet. Link WhatsApp and receive a message to start.</p>'; return; }
  list.replaceChildren();
  for (const message of messages) {
    const row = document.createElement('article'); row.className = 'message-row';
    const content = document.createElement('div'); const meta = document.createElement('div'); meta.className = 'message-meta';
    meta.textContent = (message.fromMe ? 'WHATSY REPLY' : 'INCOMING') + ' · ' + (message.pushName || message.jid.split('@')[0]);
    const text = document.createElement('p'); text.textContent = message.text; content.append(meta, text);
    const time = document.createElement('small'); time.textContent = new Date(message.timestamp).toLocaleString();
    row.append(content, time); list.appendChild(row);
  }
}
$('pairingForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = $('pairButton'); button.disabled = true; button.textContent = 'Generating…'; $('pairingResult').classList.add('hidden');
  try {
    const data = await api('/api/tenant/pairing-code', { method: 'POST', body: JSON.stringify({ phoneNumber: $('phoneNumber').value.trim() }) });
    const box = $('pairingResult'); box.replaceChildren();
    const label = document.createElement('p'); label.textContent = 'Enter this code in WhatsApp on your phone:';
    const code = document.createElement('div'); code.className = 'pairing-code'; code.textContent = data.pairingCode;
    const hint = document.createElement('p'); hint.className = 'muted small'; hint.textContent = 'Do not share this code. It links your WhatsApp account to this workspace.';
    box.append(label, code, hint); box.classList.remove('hidden'); toast('Pairing code generated.'); await loadStatus();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = 'Generate pairing code'; }
});
$('settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = $('saveButton'); button.disabled = true; $('settingsMessage').textContent = 'Saving…';
  try {
    await api('/api/tenant/config', { method: 'POST', body: JSON.stringify({
      bot: { autoReply: $('autoReply').checked, isPaused: $('isPaused').checked, ignoreGroups: !$('replyInGroups').checked, ownerName: $('ownerName').value.trim(), minDelayMs: Number($('minDelayMs').value), maxDelayMs: Number($('maxDelayMs').value) },
      ai: { systemInstructions: $('systemInstructions').value }
    }) });
    $('settingsMessage').textContent = 'Settings saved.'; toast('Settings saved.');
  } catch (error) { $('settingsMessage').textContent = error.message; }
  finally { button.disabled = false; }
});
$('disconnectButton').addEventListener('click', async () => {
  if (!window.confirm('Disconnect this WhatsApp account and remove its saved link credentials?')) return;
  $('disconnectButton').disabled = true;
  try { await api('/api/tenant/disconnect', { method: 'POST', body: '{}' }); $('pairingResult').classList.add('hidden'); await loadStatus(); toast('WhatsApp disconnected.'); }
  catch (error) { toast(error.message); }
  finally { $('disconnectButton').disabled = false; }
});
$('logoutButton').addEventListener('click', async () => {
  try { await api('/api/tenant/logout', { method: 'POST', body: '{}' }); } catch (_) {}
  window.location.assign('/login');
});
$('refreshMessages').addEventListener('click', () => loadMessages().catch((error) => toast(error.message)));
(async function init() {
  try { await loadAccount(); await Promise.all([loadStatus(), loadSettings(), loadMessages()]); setInterval(() => loadStatus().catch(() => {}), 5000); }
  catch (error) { if (error.message) toast(error.message); }
})();
