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
- **Web Dashboard**: Interactive management UI at `http://localhost:3000` for live chats, deleted message inspection, status views, and config management.