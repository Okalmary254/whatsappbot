const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

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
      ownerName: process.env.ASSISTANT_OWNER_NAME || "Alex",
      autoViewStatus: true,
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
      provider: process.env.AI_PROVIDER || "auto", // "auto", "anthropic", "openai", "gemini"
      anthropicApiKey: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || "",
      anthropicModel: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
      openaiApiKey: process.env.OPENAI_API_KEY || "",
      openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
      geminiApiKey: process.env.GEMINI_API_KEY || "",
      geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-flash",
      systemInstructions: `You are a polite, helpful WhatsApp personal AI assistant for ${process.env.ASSISTANT_OWNER_NAME || 'your owner'}. 
Reply concisely, naturally, and conversationally. Keep answers short, friendly, and appropriate for instant messaging.`
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

        // Normalize legacy model names if present
        if (merged.ai.geminiModel && merged.ai.geminiModel.includes('gemini-2')) {
          merged.ai.geminiModel = 'gemini-1.5-flash';
        }

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
    const ownerName = this.config.bot.ownerName || process.env.ASSISTANT_OWNER_NAME || "Alex";
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
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving config file:', err);
    }
  }
}

module.exports = new ConfigManager();
