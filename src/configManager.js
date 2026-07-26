const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULT_CONFIG = {
  bot: {
    name: "WhatsApp AI Assistant",
    autoViewStatus: true,
    autoReactStatus: false,
    statusReactionEmoji: "💚",
    autoReply: true,
    replyMode: "ai", // "ai" or "rules" or "hybrid"
    ignoreGroups: true,
    naturalDelayMs: 2500,
    allowedSenders: [],
    ignoredSenders: []
  },
  ai: {
    provider: "gemini",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    model: "gemini-2.0-flash",
    systemInstructions: `You are a polite, helpful WhatsApp assistant. 
Reply concisely and conversationally. Keep answers short and appropriate for instant messaging.`
  },
  rules: [
    {
      id: "1",
      trigger: "hello",
      type: "contains",
      response: "Hello! 👋 I am an automated assistant. How can I help you today?"
    },
    {
      id: "2",
      trigger: "price",
      type: "contains",
      response: "For pricing details, please reach out or ask specific questions here!"
    }
  ]
};

class ConfigManager extends EventEmitter {
  constructor() {
    super();
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(data);
        const merged = { ...DEFAULT_CONFIG, ...parsed, ai: { ...DEFAULT_CONFIG.ai, ...(parsed.ai || {}) } };
        if (merged.ai.model === 'gemini-2.5-flash' || !merged.ai.model) {
          merged.ai.model = 'gemini-2.0-flash';
        }
        return merged;
      }
    } catch (err) {
      console.error('Error reading config file, using default:', err);
    }
    this.saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  getConfig() {
    return this.config;
  }

  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
      bot: { ...this.config.bot, ...(newConfig.bot || {}) },
      ai: { ...this.config.ai, ...(newConfig.ai || {}) },
      rules: newConfig.rules || this.config.rules
    };
    this.saveConfig(this.config);
    this.emit('configUpdated', this.config);
    return this.config;
  }

  saveConfig(cfg) {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving config file:', err);
    }
  }
}

module.exports = new ConfigManager();
