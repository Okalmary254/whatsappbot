# ⚡ WhatsApp Auto Status Viewer & AI Chatbot

A WhatsApp automated bot built with **Node.js** and **Baileys WebSocket API** that automatically views WhatsApp status stories and replies to incoming messages based on custom AI instructions or keyword rules. Includes a modern **Web Control Center Dashboard** running on `http://localhost:3000`.

---

## ✨ Features

- 👁️ **Auto Status Viewer**: Automatically views and marks status updates (`status@broadcast`) as read immediately when your contacts post stories.
- 💬 **Instruction-Based AI Auto Responder**: Powered by **Google Gemini API** or **Keyword Rules**. Define custom system instructions (e.g. tone, persona, business rules) to control how the bot answers incoming messages.
- 🎛️ **Modern Web Dashboard**: Real-time control center at `http://localhost:3000` to view status feeds, auto-reply logs, scan QR codes, and edit bot instructions on the fly without restarting.
- ⚡ **Rule Engine & Hybrid Mode**: Set specific keyword triggers for instant responses, or mix rules with Gemini AI.
- 🕒 **Natural Typing Presence**: Simulates typing status (`composing`) with customizable delays for natural human-like responses.
- 👥 **Group Filter**: Toggle auto-replies for direct messages only or include group chats.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Bot & Dashboard
```bash
npm start
```

### 3. Scan the QR Code
- Open your terminal or navigate to `http://localhost:3000` in your web browser.
- Open **WhatsApp** on your phone → **Linked Devices** → **Link a Device**.
- Scan the displayed QR Code.

---

## ⚙️ Configuration & Custom Instructions

You can edit instructions and settings live in the Web Dashboard at `http://localhost:3000` or by editing `config.json`.

### Settings Overview
- **Auto View Status**: Toggle auto-reading status stories ON/OFF.
- **Reply Mode**:
  - `ai`: Uses Google Gemini API with system instructions.
  - `hybrid`: Checks keyword rules first, falls back to Gemini AI.
  - `rules`: Answers only when keyword rules match.
- **Google Gemini API Key**: Optional API key for Google Gemini (`gemini-2.5-flash`).
- **System Instructions (Prompt)**: The exact rules and instructions for how the AI should answer your contacts.

---

## 📁 File Structure

- `src/bot.js` - Core WhatsApp connection logic & event listeners
- `src/statusHandler.js` - Auto status story viewer
- `src/messageHandler.js` - Auto-reply handler with typing presence
- `src/aiService.js` - AI response generation using Google Gemini & keyword engine
- `src/configManager.js` - Manages live configuration & persistence
- `src/server.js` - Express API & WebSocket web dashboard server
- `public/` - Web Dashboard (HTML, CSS, JS)
