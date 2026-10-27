const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  const legacyPath = path.join(__dirname, '..', 'config.json');
  if (legacyPath !== CONFIG_PATH && fs.existsSync(legacyPath)) {
    try { fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true }); fs.copyFileSync(legacyPath, CONFIG_PATH); }
    catch (err) { console.error('Could not migrate config.json:', err.message); }
  }
}

function parseNumberList(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(n => String(n).trim()).filter(Boolean);
  if (typeof val === 'string') {
    return val.split(',').map(n => n.trim()).filter(Boolean);
  }
  return [];
}

function getEnvConfig() {
  const minDelay = parseInt(process.env.REPLY_DELAY_MIN_MS, 10) || 2000;
  const maxDelay = parseInt(process.env.REPLY_DELAY_MAX_MS, 10) || 5000;
  const replyInGroups = process.env.REPLY_IN_GROUPS === 'true';
  const whitelistMode = process.env.WHITELIST_MODE === 'true';

  return {
    bot: {
      name: "WhatsApp AI Assistant",
      ownerName: process.env.ASSISTANT_OWNER_NAME || "John",
      autoViewStatus: false,
      autoReactStatus: false,
      statusReactionEmoji: "💚",
      autoReply: true,
      isPaused: false,
      replyMode: "ai", // "ai" or "rules" or "hybrid"
      ignoreGroups: !replyInGroups,
      replyInGroups: replyInGroups,
      minDelayMs: minDelay,
      maxDelayMs: maxDelay,
      naturalDelayMs: minDelay,
      whitelistMode: whitelistMode,
      ignoredSenders: parseNumberList(process.env.IGNORE_NUMBERS),
      allowedSenders: parseNumberList(process.env.ALLOWED_NUMBERS)
    },
    ai: {
      provider: "groq",
      groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      systemInstructions: `You are a polite, helpful WhatsApp personal AI assistant for ${process.env.ASSISTANT_OWNER_NAME || 'your owner'}.
Reply concisely, naturally, and conversationally. Keep answers short, friendly, and appropriate for instant messaging.`
    },
    rules: [
      {
        id: "1",
        trigger: "hello",
        type: "contains",
        response: "Hello! 👋 I'm Jean, an automated assistant. How can I help you today?"
      },
      {
        id: "2",
        trigger: "price",
        type: "contains",
        response: "For pricing details, please reach out or ask specific questions here!"
      }
    ]
  };
}

class ConfigManager extends EventEmitter {
  constructor() {
    super();
    this.config = this.loadConfig();
  }

  loadConfig() {
    const defaultConfig = getEnvConfig();
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(data);

        // Merge file config with environment defaults
        const merged = {
          ...defaultConfig,
          ...parsed,
          bot: { ...defaultConfig.bot, ...(parsed.bot || {}) },
          ai: { ...defaultConfig.ai, ...(parsed.ai || {}) },
          rules: parsed.rules || defaultConfig.rules
        };

        merged.ai.provider = "groq";
        merged.ai.groqModel = process.env.GROQ_MODEL || merged.ai.groqModel || "openai/gpt-oss-120b";

        return merged;
      }
    } catch (err) {
      console.error('Error reading config file, using default:', err);
    }
    this.saveConfig(defaultConfig);
    return defaultConfig;
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

    // Ensure owner name updates system instructions if needed
    const ownerName = this.config.bot.ownerName || process.env.ASSISTANT_OWNER_NAME || "John";
    if (!newConfig.ai?.systemInstructions) {
      this.config.ai.systemInstructions = `You are a polite, helpful WhatsApp personal AI assistant for ${ownerName}.
Reply concisely, naturally, and conversationally. Keep answers short, friendly, and appropriate for instant messaging.`;
    }

    this.saveConfig(this.config);
    this.emit('configUpdated', this.config);
    return this.config;
  }

  setPaused(isPaused) {
    this.config.bot.isPaused = Boolean(isPaused);
    this.saveConfig(this.config);
    this.emit('configUpdated', this.config);
    return this.config.bot.isPaused;
  }

  saveConfig(cfg) {
    try {
      const safeConfig = { ...cfg, ai: { ...(cfg.ai || {}) } };
      delete safeConfig.ai.groqApiKey;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(safeConfig, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving config file:', err);
    }
  }
}

module.exports = new ConfigManager();
