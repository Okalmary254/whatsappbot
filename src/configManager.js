const EventEmitter = require('events');
const { pool, ready } = require('./db');

function parseNumberList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((n) => String(n).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((n) => n.trim()).filter(Boolean);
  return [];
}

function getEnvConfig() {
  const minDelay = parseInt(process.env.REPLY_DELAY_MIN_MS, 10) || 2000;
  const maxDelayMs = parseInt(process.env.REPLY_DELAY_MAX_MS, 10) || 5000;
  const replyInGroups = process.env.REPLY_IN_GROUPS === 'true';
  const whitelistMode = process.env.WHITELIST_MODE === 'true';
  const ownerName = process.env.ASSISTANT_OWNER_NAME || 'John';

  return {
    bot: {
      name: 'WhatsApp AI Assistant',
      ownerName,
      autoViewStatus: false,
      autoReactStatus: false,
      statusReactionEmoji: '💚',
      autoReply: true,
      isPaused: false,
      replyMode: 'ai',
      ignoreGroups: !replyInGroups,
      replyInGroups,
      minDelayMs: minDelay,
      maxDelayMs,
      naturalDelayMs: minDelay,
      whitelistMode,
      ignoredSenders: parseNumberList(process.env.IGNORE_NUMBERS),
      allowedSenders: parseNumberList(process.env.ALLOWED_NUMBERS),
    },
    ai: {
      provider: 'groq',
      groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      systemInstructions: `You are a polite, helpful WhatsApp personal AI assistant for ${ownerName}.
Reply concisely, naturally, and conversationally. Keep answers short, friendly, and appropriate for instant messaging.`,
    },
    rules: [
      {
        id: '1',
        trigger: 'hello',
        type: 'contains',
        response: "Hello! 👋 I'm Jean, an automated assistant. How can I help you today?",
      },
      {
        id: '2',
        trigger: 'price',
        type: 'contains',
        response: 'For pricing details, please reach out or ask specific questions here!',
      },
    ],
  };
}

function mergeConfig(defaultConfig, parsed = {}) {
  const merged = {
    ...defaultConfig,
    ...parsed,
    bot: { ...defaultConfig.bot, ...(parsed.bot || {}) },
    ai: { ...defaultConfig.ai, ...(parsed.ai || {}) },
    rules: Array.isArray(parsed.rules) ? parsed.rules : defaultConfig.rules,
  };

  // API keys must come from environment variables, not persisted dashboard config.
  merged.ai.provider = 'groq';
  merged.ai.groqModel = process.env.GROQ_MODEL || merged.ai.groqModel || 'openai/gpt-oss-120b';
  delete merged.ai.groqApiKey;
  return merged;
}

class ConfigManager extends EventEmitter {
  constructor() {
    super();
    this.config = getEnvConfig();
    this.ready = this.loadConfig();
    this.ready.catch((err) => {
      console.error('Could not load config from PostgreSQL; using environment defaults:', err.message);
    });
  }

  async loadConfig() {
    await ready;
    const result = await pool.query(
      'SELECT config FROM bot_config WHERE config_key = $1',
      ['main']
    );

    if (result.rows[0]?.config) {
      this.config = mergeConfig(getEnvConfig(), result.rows[0].config);
    } else {
      this.config = mergeConfig(getEnvConfig(), this.config);
      await this.persistConfig(this.config);
    }
    return this.config;
  }

  getConfig() {
    return this.config;
  }

  updateConfig(newConfig) {
    this.config = mergeConfig(this.config, {
      ...this.config,
      ...newConfig,
      bot: { ...this.config.bot, ...(newConfig.bot || {}) },
      ai: { ...this.config.ai, ...(newConfig.ai || {}) },
      rules: newConfig.rules || this.config.rules,
    });

    const ownerName = this.config.bot.ownerName || process.env.ASSISTANT_OWNER_NAME || 'John';
    if (!newConfig.ai?.systemInstructions) {
      this.config.ai.systemInstructions = `You are a polite, helpful WhatsApp personal AI assistant for ${ownerName}.
Reply concisely, naturally, and conversationally. Keep answers short, friendly, and appropriate for instant messaging.`;
    }

    this.persistConfig(this.config).catch((err) => {
      console.error('Error saving config to PostgreSQL:', err.message);
    });
    this.emit('configUpdated', this.config);
    return this.config;
  }

  setPaused(isPaused) {
    this.config.bot.isPaused = Boolean(isPaused);
    this.persistConfig(this.config).catch((err) => {
      console.error('Error saving paused state to PostgreSQL:', err.message);
    });
    this.emit('configUpdated', this.config);
    return this.config.bot.isPaused;
  }

  async persistConfig(config) {
    await ready;
    const safeConfig = JSON.parse(JSON.stringify(config));
    if (safeConfig.ai) delete safeConfig.ai.groqApiKey;

    await pool.query(
      `INSERT INTO bot_config (config_key, config, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (config_key)
       DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
      ['main', JSON.stringify(safeConfig)]
    );
  }
}

module.exports = new ConfigManager();
