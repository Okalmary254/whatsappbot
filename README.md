# WhatsApp Personal AI Agent

WhatsApp personal assistant built with Baileys, an Express web dashboard, SQLite chat history, and Groq AI.

## Features
- Link WhatsApp by QR code or phone pairing code.
- Automatic replies to eligible chats using Groq.
- Per-chat message history stored in SQLite.
- Dashboard for chats, response rules, configuration, logs, and manual messages.
- Owner commands: `/pause`, `/resume`, `/deleted`, and `/status`.
- Group replies are disabled by default.
- Status viewing and status digest functionality are disabled.

## Setup
Requires Node.js 18+ and a Groq API key.

```bash
git clone https://github.com/Okalmary254/whatsappbot.git
cd whatsappbot
npm install
cp .env.example .env
```

Edit `.env` and set `GROQ_API_KEY`, then start the application:

```bash
npm start
```

Open http://localhost:3000 and link WhatsApp using the QR code or pairing flow.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `GROQ_API_KEY` | Groq secret key from https://console.groq.com/keys | Required |
| `GROQ_MODEL` | Model identifier | `openai/gpt-oss-120b` |
| `ASSISTANT_OWNER_NAME` | Assistant prompt owner name | `Jean` |
| `REPLY_IN_GROUPS` | Enable group replies | `false` |
| `WHITELIST_MODE` | Restrict replies to allowed numbers | `false` |
| `ALLOWED_NUMBERS` | Comma-separated permitted numbers | Empty |
| `IGNORE_NUMBERS` | Comma-separated ignored numbers | Empty |
| `REPLY_DELAY_MIN_MS` | Minimum reply delay | `2000` |
| `REPLY_DELAY_MAX_MS` | Maximum reply delay | `5000` |
| `AUTH_DIR` | WhatsApp authentication directory | `auth_info` |
| `PORT` | Dashboard port | `3000` |

The dashboard allows changing the model and system instructions. Set the Groq key only in the server environment, not in dashboard settings or source files.

## Owner commands
- `/pause` — pause automatic replies.
- `/resume` — resume automatic replies.
- `/deleted` — view recovered deleted messages where available.
- `/status` or `/help` — view bot status and commands.

## Deployment
Use a host with persistent storage for the WhatsApp auth directory and SQLite database. Configure `GROQ_API_KEY` in the host's environment settings. Protect the dashboard with authentication or network restrictions before exposing it to the internet.

## Security
Never commit `.env`, WhatsApp session files, or API keys. If a key was committed previously, revoke it and create a replacement; removing it from the latest file does not remove it from Git history.
