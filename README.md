# WhatsApp Personal Assistant

A feature-packed personal WhatsApp bot built on Baileys (unofficial WhatsApp Web protocol) that:
- Auto-replies to DMs using **Anthropic Claude**, **OpenAI**, or **Google Gemini**, with per-contact conversation memory.
- Views (but doesn't download) contacts' status updates and tracks them.
- Generates **Status Digest Summaries** of status updates posted by contacts.
- Sends **typing indicators** (`composing`) and randomized natural delays so replies feel human and avoid bot detection.
- Saves and restores **deleted/revoked messages** from your contacts.
- Persists all conversation memory, chats, status views, and deleted messages in a local **SQLite database** (`data/bot_database.sqlite`) across process restarts.
- Features **Owner Commands** (`/pause`, `/resume`, `/digest`, `/deleted`, `/help`) to control the bot directly from your own WhatsApp account.
- Supports **Whitelist Mode** and **Ignore Lists** to restrict who the bot auto-replies to.

---

## 1. Local Setup

```bash
npm install
cp .env.example .env
# Fill in your ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY in .env
npm start
```

A QR code prints in your terminal. On your phone:
**WhatsApp > Settings > Linked Devices > Link a Device**, scan the QR code.

Alternatively, visit the Web Dashboard at `http://localhost:3000` to scan the QR code or link via phone number pairing code.

Once linked, an `auth_info/` folder appears holding your session. **Never commit this folder or share it.**

---

## 2. Deploying to Render

Render's disk is **ephemeral by default**, meaning `auth_info/` gets wiped on every redeploy or restart, and you'd have to rescan the QR code each time. To avoid that:

1. Push this project to a **private** GitHub repo (`auth_info/` and `data/` must never be exposed).
2. On Render: **New > Background Worker**.
3. Under the service's **Disks** tab, add a persistent disk, e.g. 1GB, mount path `/opt/render/project/src/auth_info`.
4. Set `AUTH_DIR=/opt/render/project/src/auth_info` as an environment variable (matches the mount path).
5. Add your other env vars from `.env.example` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.) in Render's Environment tab.
6. Build command: `npm install`. Start command: `npm start`.
7. Deploy. Check the **Logs** tab for the QR code output and scan it.

---

## 3. Configuration Knobs (.env)

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Port for Express Web Server & Dashboard | `3000` |
| `AUTH_DIR` | Directory path for Baileys session storage | `auth_info` |
| `ASSISTANT_OWNER_NAME` | Name of the owner used in AI system prompts | `Alex` |
| `AI_PROVIDER` | AI provider to use (`auto`, `anthropic`, `openai`, `gemini`) | `auto` |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key | Optional |
| `ANTHROPIC_MODEL` | Claude model name | `claude-3-5-sonnet-20241022` |
| `OPENAI_API_KEY` | OpenAI API key | Optional |
| `OPENAI_MODEL` | OpenAI model name | `gpt-4o-mini` |
| `GEMINI_API_KEY` | Google Gemini API key | Optional |
| `GEMINI_MODEL` | Gemini model name | `gemini-2.0-flash` |
| `IGNORE_NUMBERS` | Comma-separated numbers to never auto-reply to | Empty |
| `REPLY_IN_GROUPS` | `true`/`false`. Set `true` to enable group replies | `false` |
| `WHITELIST_MODE` | `true`/`false`. Set `true` to only reply to allowed numbers | `false` |
| `ALLOWED_NUMBERS` | Comma-separated numbers allowed in Whitelist mode | Empty |
| `REPLY_DELAY_MIN_MS` | Minimum randomized typing delay in milliseconds | `2000` |
| `REPLY_DELAY_MAX_MS` | Maximum randomized typing delay in milliseconds | `5000` |

---

## 4. Owner Commands (Control Bot from your WhatsApp)

Send these commands from your own WhatsApp account (or linked self-chat):

- `/pause` : Temporarily pause auto-replies (e.g. when you're active online).
- `/resume` or `/unpause` : Resume auto-reply mode.
- `/digest` or `/statusdigest` : Generate an AI-powered digest summary of all status updates captured today.
- `/deleted` : View recently saved deleted/revoked messages from contacts.
- `/help` or `/status` : Check current bot state (AI Provider, Active/Paused status, delay range, etc.).

---

## 5. Architecture & Features

- **Multi-AI Provider Integration**: Automatically detects and uses Claude (`@anthropic-ai/sdk`), OpenAI (`openai`), or Gemini (`@google/genai`).
- **Per-Contact Conversation Memory**: Maintains context per contact across messages.
- **SQLite Database Persistence**: All messages, chats, status views, and deleted messages are stored in `data/bot_database.sqlite`.
- **Status Digest Summaries**: Automatically captures status updates and generates digestible daily summaries on command or via API (`/api/status-digest`).
- **Human-like Behavior**: Sends WhatsApp `composing` typing status during a randomized delay interval (`REPLY_DELAY_MIN_MS` to `REPLY_DELAY_MAX_MS`).
- **Web Dashboard**: Interactive management UI at `http://localhost:3000` for live chats, deleted message inspection, status views, and config management

# Whatsy Group Moderation Module

Drop-in group moderation features for your Baileys WhatsApp bot: **antilink**, **antidelete**, **antimention**, and **welcome/goodbye messages**, plus the admin command router that drives them from WhatsApp chat.

## Files

- `store.js` — Persistent per-group settings + message cache
- `antilink.js` — Antilink moderation handler
- `antidelete.js` — Antidelete moderation handler
- `antimention.js` — Antimention moderation handler
- `welcome.js` — Welcome / goodbye message handler
- `commands.js` — Admin command router
- `index.js` — Integration guide / wiring

## Integration notes

- Bot needs **group-admin rights in WhatsApp itself** for delete-based moderation to work — Baileys can't delete a message the bot doesn't have permission to remove.
- `ADMIN_NUMBERS` env var is assumed comma-separated phone numbers, matching your dashboard's existing convention. Confirm this matches your current bot's parsing.
- `store.js` uses a JSON file by default (`WHATSY_DB_PATH` env var to override location). Swap `readDB`/`writeDB` for Postgres/Prisma later if you want shared state with your Django backend.
- See `index.js` at the bottom for exact wiring into `messages.upsert` and `group-participants.update`.

## Commands (Admin tier)

| Command | Usage |
|---|---|
| `/antilink` | `/antilink on\|off` |
| `/antidelete` | `/antidelete on\|off` |
| `/antimention` | `/antimention on\|off [limit]` |
| `/welcome` | `/welcome on\|off`, `/welcome set <msg>`, `/welcome goodbye <msg\|off>` |

## `store.js`

Persistent per-group settings + message cache

```javascript
/**
 * store.js
 * Lightweight JSON-backed settings + message cache store for Whatsy moderation.
 *
 * Drop-in for now; swap `readDB`/`writeDB` for a Postgres/Prisma layer later
 * if you want this to share a DB with your Django backend (e.g. via a
 * shared "bot_settings" table exposed through a small internal API).
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.WHATSY_DB_PATH || path.join(__dirname, 'data', 'moderation.json');

function ensureDB() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ groups: {} }, null, 2));
  }
}

function readDB() {
  ensureDB();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    console.error('[store] Failed to read DB, resetting:', err.message);
    const fresh = { groups: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function writeDB(data) {
  ensureDB();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

const DEFAULT_GROUP_SETTINGS = {
  antilink: false,
  antidelete: false,
  antimention: false,
  antimentionLimit: 5, // max unique mentions in one message before action
  welcome: false,
  welcomeMessage: 'Welcome to the group, {mention}! 👋 Please check the pinned rules.',
  goodbyeMessage: null, // optional, set via /welcome goodbye <text>
  warnings: {}, // { "2547xxxxxxx@s.whatsapp.net": count }
};

function getGroupSettings(groupId) {
  const db = readDB();
  if (!db.groups[groupId]) {
    db.groups[groupId] = { ...DEFAULT_GROUP_SETTINGS };
    writeDB(db);
  }
  // merge in any new default keys added after a group was first created
  return { ...DEFAULT_GROUP_SETTINGS, ...db.groups[groupId] };
}

function updateGroupSettings(groupId, patch) {
  const db = readDB();
  const current = db.groups[groupId] || { ...DEFAULT_GROUP_SETTINGS };
  db.groups[groupId] = { ...current, ...patch };
  writeDB(db);
  return db.groups[groupId];
}

function incrementWarning(groupId, participantId) {
  const db = readDB();
  const group = db.groups[groupId] || { ...DEFAULT_GROUP_SETTINGS, warnings: {} };
  group.warnings = group.warnings || {};
  group.warnings[participantId] = (group.warnings[participantId] || 0) + 1;
  db.groups[groupId] = group;
  writeDB(db);
  return group.warnings[participantId];
}

/* ---------- Message cache for antidelete ---------- */
// In-memory LRU-ish cache keyed by message id. Baileys fires a "message
// revoke" protocol message on delete; we need the original content cached
// to be able to resend it. Keep this in memory (not JSON) for speed;
// swap for Redis if you run multiple bot instances.

const MAX_CACHE_SIZE = 2000;
const messageCache = new Map(); // key: `${remoteJid}:${messageId}` -> { content, sender, timestamp, type }

function cacheMessage(remoteJid, messageId, entry) {
  const key = `${remoteJid}:${messageId}`;
  messageCache.set(key, entry);
  if (messageCache.size > MAX_CACHE_SIZE) {
    const oldestKey = messageCache.keys().next().value;
    messageCache.delete(oldestKey);
  }
}

function getCachedMessage(remoteJid, messageId) {
  return messageCache.get(`${remoteJid}:${messageId}`);
}

module.exports = {
  getGroupSettings,
  updateGroupSettings,
  incrementWarning,
  cacheMessage,
  getCachedMessage,
  DEFAULT_GROUP_SETTINGS,
};
```

## `antilink.js`

Antilink moderation handler

```javascript
/**
 * antilink.js
 * Detects and removes messages containing links when antilink is enabled
 * for a group. Exempts group admins and bot admins (ADMIN_NUMBERS) by default.
 */

const { getGroupSettings, incrementWarning } = require('./store');

// Covers http(s) links, bare domains, wa.me/chat.whatsapp.com invite links,
// and common shorteners. Adjust as needed.
const LINK_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+\.[a-z]{2,})|(chat\.whatsapp\.com\/[^\s]+)|([a-z0-9-]+\.(com|net|org|io|co|ke|link|xyz)\/?[^\s]*)/i;

function containsLink(text) {
  if (!text) return false;
  return LINK_REGEX.test(text);
}

function extractText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ''
  );
}

/**
 * @param sock - active Baileys socket
 * @param msg - the full message object from messages.upsert
 * @param opts.isAdmin - whether the sender is a group admin (you compute this
 *   via groupMetadata participants before calling)
 * @param opts.isBotAdmin - whether sender is in your ADMIN_NUMBERS env list
 */
async function handleAntilink(sock, msg, { isAdmin, isBotAdmin } = {}) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid?.endsWith('@g.us')) return false; // groups only

  const settings = getGroupSettings(remoteJid);
  if (!settings.antilink) return false;
  if (isAdmin || isBotAdmin) return false; // admins exempt

  const text = extractText(msg.message);
  if (!containsLink(text)) return false;

  const sender = msg.key.participant || msg.key.remoteJid;

  try {
    // Delete the offending message (bot must be group admin)
    await sock.sendMessage(remoteJid, { delete: msg.key });

    const warnCount = incrementWarning(remoteJid, sender);
    const mentionTag = `@${sender.split('@')[0]}`;

    await sock.sendMessage(remoteJid, {
      text: `🚫 ${mentionTag} links aren't allowed in this group. (Warning ${warnCount})`,
      mentions: [sender],
    });

    return true; // message was actioned
  } catch (err) {
    console.error('[antilink] Failed to delete message:', err.message);
    return false;
  }
}

module.exports = { handleAntilink, containsLink };
```

## `antidelete.js`

Antidelete moderation handler

```javascript
/**
 * antidelete.js
 * Caches every incoming group message (text/media metadata), and when a
 * "revoke" (delete) protocol message comes in, reposts the original content
 * with an attribution note — but only if antidelete is enabled for that group.
 */

const { getGroupSettings, cacheMessage, getCachedMessage } = require('./store');

/**
 * Call this on EVERY incoming message (in your messages.upsert handler),
 * before you do anything else with it. Cheap — just stores a lightweight copy.
 */
function cacheIncomingMessage(msg) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid?.endsWith('@g.us')) return;
  if (!msg.message) return;

  const messageId = msg.key.id;
  const sender = msg.key.participant || msg.key.remoteJid;

  const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    null;

  const type = Object.keys(msg.message)[0]; // e.g. 'conversation', 'imageMessage'

  cacheMessage(remoteJid, messageId, {
    sender,
    text,
    type,
    timestamp: Date.now(),
  });
}

/**
 * Call this when a protocolMessage with type REVOKE arrives.
 * In Baileys, revoke messages show up in messages.upsert as:
 *   msg.message.protocolMessage.type === 0 (REVOKE)
 * with msg.message.protocolMessage.key pointing to the original message.
 */
async function handleRevoke(sock, msg) {
  const protocolMsg = msg.message?.protocolMessage;
  if (!protocolMsg || protocolMsg.type !== 0) return false; // 0 = REVOKE in Baileys enum

  const remoteJid = msg.key.remoteJid;
  if (!remoteJid?.endsWith('@g.us')) return false;

  const settings = getGroupSettings(remoteJid);
  if (!settings.antidelete) return false;

  const originalKey = protocolMsg.key;
  const cached = getCachedMessage(remoteJid, originalKey.id);
  if (!cached) return false; // nothing cached, can't recover

  const deletedBy = msg.key.participant || msg.key.remoteJid;
  const senderTag = `@${cached.sender.split('@')[0]}`;
  const deleterTag = `@${deletedBy.split('@')[0]}`;

  const content = cached.text
    ? `🗑️ *Deleted message recovered*\nFrom: ${senderTag}\nDeleted by: ${deleterTag}\n\n${cached.text}`
    : `🗑️ *Deleted message recovered*\nFrom: ${senderTag}\nDeleted by: ${deleterTag}\n(media message — content type: ${cached.type})`;

  await sock.sendMessage(remoteJid, {
    text: content,
    mentions: [cached.sender, deletedBy],
  });

  return true;
}

module.exports = { cacheIncomingMessage, handleRevoke };
```

## `antimention.js`

Antimention moderation handler

```javascript
/**
 * antimention.js
 * Flags/removes messages that @mention more than `antimentionLimit`
 * unique participants at once (classic mention-spam / tagall abuse).
 */

const { getGroupSettings, incrementWarning } = require('./store');

function getMentionedJids(message) {
  return (
    message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    message?.imageMessage?.contextInfo?.mentionedJid ||
    message?.videoMessage?.contextInfo?.mentionedJid ||
    []
  );
}

async function handleAntimention(sock, msg, { isAdmin, isBotAdmin } = {}) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid?.endsWith('@g.us')) return false;

  const settings = getGroupSettings(remoteJid);
  if (!settings.antimention) return false;
  if (isAdmin || isBotAdmin) return false;

  const mentioned = getMentionedJids(msg.message);
  const uniqueMentions = [...new Set(mentioned)];

  if (uniqueMentions.length <= settings.antimentionLimit) return false;

  const sender = msg.key.participant || msg.key.remoteJid;

  try {
    await sock.sendMessage(remoteJid, { delete: msg.key });

    const warnCount = incrementWarning(remoteJid, sender);
    const senderTag = `@${sender.split('@')[0]}`;

    await sock.sendMessage(remoteJid, {
      text: `🚫 ${senderTag} that's ${uniqueMentions.length} mentions in one message — over the limit of ${settings.antimentionLimit}. (Warning ${warnCount})`,
      mentions: [sender],
    });

    return true;
  } catch (err) {
    console.error('[antimention] Failed to delete message:', err.message);
    return false;
  }
}

module.exports = { handleAntimention, getMentionedJids };
```

## `welcome.js`

Welcome / goodbye message handler

```javascript
/**
 * welcome.js
 * Sends welcome/goodbye messages on group participant updates.
 * Wire this into your `groups.update` / `group-participants.update` Baileys event.
 *
 * Supports placeholders in the configured message:
 *   {mention}   -> tags the joining/leaving user
 *   {group}     -> group subject/name
 *   {count}     -> new participant count
 */

const { getGroupSettings } = require('./store');

function renderTemplate(template, { mention, groupName, count }) {
  return template
    .replace(/{mention}/g, mention)
    .replace(/{group}/g, groupName || 'the group')
    .replace(/{count}/g, String(count ?? ''));
}

/**
 * @param update - the object Baileys gives you on 'group-participants.update':
 *   { id: groupJid, participants: [jid,...], action: 'add' | 'remove' | 'promote' | 'demote' }
 */
async function handleParticipantsUpdate(sock, update) {
  const { id: groupJid, participants, action } = update;
  if (action !== 'add' && action !== 'remove') return;

  const settings = getGroupSettings(groupJid);
  if (!settings.welcome) return;

  let groupName = groupJid;
  let participantCount;
  try {
    const meta = await sock.groupMetadata(groupJid);
    groupName = meta.subject;
    participantCount = meta.participants.length;
  } catch (err) {
    console.error('[welcome] Could not fetch group metadata:', err.message);
  }

  for (const jid of participants) {
    const mentionTag = `@${jid.split('@')[0]}`;

    if (action === 'add') {
      const text = renderTemplate(settings.welcomeMessage, {
        mention: mentionTag,
        groupName,
        count: participantCount,
      });
      await sock.sendMessage(groupJid, { text, mentions: [jid] });
    } else if (action === 'remove' && settings.goodbyeMessage) {
      const text = renderTemplate(settings.goodbyeMessage, {
        mention: mentionTag,
        groupName,
        count: participantCount,
      });
      await sock.sendMessage(groupJid, { text, mentions: [jid] });
    }
  }
}

module.exports = { handleParticipantsUpdate, renderTemplate };
```

## `commands.js`

Admin command router

```javascript
/**
 * commands.js
 * Handles the admin-only slash commands from your dashboard's command table:
 *   /antilink [on|off]
 *   /antidelete [on|off]
 *   /antimention [on|off] [limit]
 *   /welcome [on|off]                -> toggles welcome
 *   /welcome set <message>           -> sets welcome template
 *   /welcome goodbye <message>       -> sets goodbye template
 *   /welcome goodbye off             -> clears goodbye template
 *
 * These are Admin-tier per your commands table, meaning: group admin OR
 * bot admin (ADMIN_NUMBERS). Compute both before calling handleCommand.
 */

const { getGroupSettings, updateGroupSettings } = require('./store');

function isAdminCommand(text) {
  return /^\/(antilink|antidelete|antimention|welcome)\b/i.test(text?.trim() || '');
}

async function handleCommand(sock, msg, { isAdmin, isBotAdmin } = {}) {
  const remoteJid = msg.key.remoteJid;
  if (!remoteJid?.endsWith('@g.us')) return false;

  const text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ''
  ).trim();

  if (!isAdminCommand(text)) return false;

  if (!isAdmin && !isBotAdmin) {
    await sock.sendMessage(remoteJid, {
      text: '⛔ Only group admins can use this command.',
    });
    return true;
  }

  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();

  const reply = (t) => sock.sendMessage(remoteJid, { text: t });

  switch (cmd) {
    case '/antilink': {
      const state = parseOnOff(args[0]);
      if (state === null) {
        const s = getGroupSettings(remoteJid);
        return void (await reply(`antilink is currently ${s.antilink ? 'ON ✅' : 'OFF ❌'}. Use /antilink on|off`));
      }
      updateGroupSettings(remoteJid, { antilink: state });
      await reply(`antilink turned ${state ? 'ON ✅' : 'OFF ❌'}.`);
      return true;
    }

    case '/antidelete': {
      const state = parseOnOff(args[0]);
      if (state === null) {
        const s = getGroupSettings(remoteJid);
        return void (await reply(`antidelete is currently ${s.antidelete ? 'ON ✅' : 'OFF ❌'}. Use /antidelete on|off`));
      }
      updateGroupSettings(remoteJid, { antidelete: state });
      await reply(`antidelete turned ${state ? 'ON ✅' : 'OFF ❌'}.`);
      return true;
    }

    case '/antimention': {
      const state = parseOnOff(args[0]);
      const limitArg = parseInt(args[1], 10);
      const patch = {};
      if (state !== null) patch.antimention = state;
      if (!Number.isNaN(limitArg) && limitArg > 0) patch.antimentionLimit = limitArg;

      if (Object.keys(patch).length === 0) {
        const s = getGroupSettings(remoteJid);
        return void (await reply(
          `antimention is currently ${s.antimention ? 'ON ✅' : 'OFF ❌'}, limit ${s.antimentionLimit}. Use /antimention on|off [limit]`
        ));
      }
      const updated = updateGroupSettings(remoteJid, patch);
      await reply(`antimention turned ${updated.antimention ? 'ON ✅' : 'OFF ❌'}, limit set to ${updated.antimentionLimit}.`);
      return true;
    }

    case '/welcome': {
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'set') {
        const message = text.replace(/^\/welcome\s+set\s+/i, '');
        if (!message) return void (await reply('Usage: /welcome set <message>. Use {mention} and {group} as placeholders.'));
        updateGroupSettings(remoteJid, { welcomeMessage: message });
        await reply('✅ Welcome message updated.');
        return true;
      }

      if (sub === 'goodbye') {
        const rest = text.replace(/^\/welcome\s+goodbye\s*/i, '');
        if (!rest || rest.toLowerCase() === 'off') {
          updateGroupSettings(remoteJid, { goodbyeMessage: null });
          await reply('✅ Goodbye message disabled.');
        } else {
          updateGroupSettings(remoteJid, { goodbyeMessage: rest });
          await reply('✅ Goodbye message updated.');
        }
        return true;
      }

      const state = parseOnOff(args[0]);
      if (state === null) {
        const s = getGroupSettings(remoteJid);
        return void (await reply(`welcome is currently ${s.welcome ? 'ON ✅' : 'OFF ❌'}. Use /welcome on|off, /welcome set <msg>, /welcome goodbye <msg>`));
      }
      updateGroupSettings(remoteJid, { welcome: state });
      await reply(`welcome messages turned ${state ? 'ON ✅' : 'OFF ❌'}.`);
      return true;
    }

    default:
      return false;
  }
}

function parseOnOff(arg) {
  if (!arg) return null;
  const v = arg.toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return null;
}

module.exports = { handleCommand, isAdminCommand };
```

## `index.js`

Integration guide / wiring

```javascript
/**
 * index.js
 * INTEGRATION EXAMPLE — not a standalone entrypoint. This shows how to wire
 * the moderation module into the Baileys event handlers your bot already has.
 * Copy the relevant snippets into your existing sock.ev.on(...) blocks.
 */

const { handleAntilink } = require('./antilink');
const { handleAntimention } = require('./antimention');
const { cacheIncomingMessage, handleRevoke } = require('./antidelete');
const { handleParticipantsUpdate } = require('./welcome');
const { handleCommand } = require('./commands');

/**
 * Helper: figure out isAdmin / isBotAdmin for a message.
 * Cache groupMetadata per-group for a few seconds if this gets called a lot —
 * fetching it on every single message is wasteful at scale.
 */
async function getSenderPrivileges(sock, msg) {
  const remoteJid = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;

  const adminNumbers = (process.env.ADMIN_NUMBERS || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const isBotAdmin = adminNumbers.some((n) => sender.includes(n));

  let isAdmin = false;
  if (remoteJid.endsWith('@g.us')) {
    try {
      const meta = await sock.groupMetadata(remoteJid);
      const participant = meta.participants.find((p) => p.id === sender);
      isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
    } catch (err) {
      console.error('[privileges] groupMetadata fetch failed:', err.message);
    }
  }

  return { isAdmin, isBotAdmin };
}

/**
 * ---- Wire this into your existing sock.ev.on('messages.upsert', ...) ----
 *
 * sock.ev.on('messages.upsert', async ({ messages, type }) => {
 *   if (type !== 'notify') return;
 *   for (const msg of messages) {
 *     if (!msg.message || msg.key.fromMe) continue;
 *     await onIncomingMessage(sock, msg); // <-- call this
 *     // ... your existing message handling continues below/after
 *   }
 * });
 */
async function onIncomingMessage(sock, msg) {
  // 1. Always cache first (needed for antidelete to work later)
  cacheIncomingMessage(msg);

  // 2. Handle revoke (delete) events
  const wasRevoke = await handleRevoke(sock, msg);
  if (wasRevoke) return true;

  const { isAdmin, isBotAdmin } = await getSenderPrivileges(sock, msg);

  // 3. Admin commands (/antilink, /antidelete, /antimention, /welcome)
  const wasCommand = await handleCommand(sock, msg, { isAdmin, isBotAdmin });
  if (wasCommand) return true;

  // 4. Moderation checks (order matters: link check before mention check
  //    is fine since each deletes-and-returns independently)
  const wasLinkActioned = await handleAntilink(sock, msg, { isAdmin, isBotAdmin });
  if (wasLinkActioned) return true;

  const wasMentionActioned = await handleAntimention(sock, msg, { isAdmin, isBotAdmin });
  if (wasMentionActioned) return true;

  return false; // let your existing message handling continue as normal
}

/**
 * ---- Wire this into your existing sock.ev.on('group-participants.update', ...) ----
 *
 * sock.ev.on('group-participants.update', async (update) => {
 *   await handleParticipantsUpdate(sock, update); // <-- call this
 * });
 */

module.exports = {
  onIncomingMessage,
  handleParticipantsUpdate,
  getSenderPrivileges,
};
```