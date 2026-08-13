const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');
const { OpenAI } = require('openai');
const logger = require('./logger');

class AIService {
  normalizeGeminiModel(model) {
    if (!model || model.includes('gemini-2')) {
      return 'gemini-1.5-flash';
    }
    return model;
  }

  async generateResponse(incomingText, chatHistory = [], config) {
    const aiConfig = config.ai || {};
    const rules = config.rules || [];
    const mode = config.bot?.replyMode || "ai";

    const anthropicKey = (aiConfig.anthropicApiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
    const openaiKey = (aiConfig.openaiApiKey || process.env.OPENAI_API_KEY || '').trim();
    const geminiKey = (aiConfig.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();

    // Select provider based on config or available API keys
    let provider = (aiConfig.provider || process.env.AI_PROVIDER || 'auto').toLowerCase();
    if (provider === 'claude') provider = 'anthropic';

    // If the chosen provider lacks a key, fallback to auto
    if (provider === 'anthropic' && !anthropicKey) provider = 'auto';
    if (provider === 'openai' && !openaiKey) provider = 'auto';
    if (provider === 'gemini' && !geminiKey) provider = 'auto';

    if (provider === 'auto') {
      if (anthropicKey) provider = 'anthropic';
      else if (openaiKey) provider = 'openai';
      else if (geminiKey) provider = 'gemini';
    }

    const hasAnyKey = Boolean(anthropicKey || openaiKey || geminiKey);

    // If mode is "rules" or no AI key provided, try rule matching
    if (mode === "rules" || !hasAnyKey) {
      if (!hasAnyKey && mode !== "rules") {
        logger.log('system', '⚠️ AI mode active but no AI API Key provided. Falling back to keyword rules.');
      }
      const ruleMatch = this.matchRules(incomingText, rules);
      if (ruleMatch) return ruleMatch;
      if (mode === "rules") return null;
    }

    // Hybrid mode: Check exact/contains rule trigger first before calling AI
    if (mode === "hybrid") {
      const ruleMatch = this.matchRules(incomingText, rules);
      if (ruleMatch) return ruleMatch;
    }

    const ownerName = config.bot?.ownerName || process.env.ASSISTANT_OWNER_NAME || 'Alex';
    const systemInstruction = aiConfig.systemInstructions && aiConfig.systemInstructions.trim() !== ''
      ? aiConfig.systemInstructions.trim()
      : `You are a polite, helpful WhatsApp personal AI assistant for ${ownerName}. Reply concisely, naturally, and conversationally. Keep answers short, friendly, and appropriate for instant messaging.`;

    // Try selected provider
    try {
      if (provider === 'anthropic' && anthropicKey) {
        return await this.generateAnthropic(incomingText, chatHistory, anthropicKey, aiConfig.anthropicModel || 'claude-3-5-sonnet-20241022', systemInstruction);
      } else if (provider === 'openai' && openaiKey) {
        return await this.generateOpenAI(incomingText, chatHistory, openaiKey, aiConfig.openaiModel || 'gpt-4o-mini', systemInstruction);
      } else if ((provider === 'gemini' || geminiKey) && geminiKey) {
        return await this.generateGemini(incomingText, chatHistory, geminiKey, aiConfig.geminiModel || 'gemini-1.5-flash', systemInstruction);
      } else if (anthropicKey) {
        return await this.generateAnthropic(incomingText, chatHistory, anthropicKey, aiConfig.anthropicModel || 'claude-3-5-sonnet-20241022', systemInstruction);
      } else if (openaiKey) {
        return await this.generateOpenAI(incomingText, chatHistory, openaiKey, aiConfig.openaiModel || 'gpt-4o-mini', systemInstruction);
      }
    } catch (err) {
      console.error(`AI Generation Error (${provider}):`, err.message);
      logger.log('error', `❌ AI Error (${provider}): ${err.message}`);
    }

    // Fallback to keyword rules if AI generation fails or no response
    return this.matchRules(incomingText, rules);
  }

  async generateAnthropic(incomingText, chatHistory, apiKey, model, systemInstruction) {
    const anthropic = new Anthropic({ apiKey });
    
    // Format conversation history for Anthropic messages API
    const messages = [];
    const recentHistory = chatHistory.slice(-8); // include last 8 turns

    for (const msg of recentHistory) {
      if (!msg.text || msg.text.startsWith('🗑️')) continue;
      messages.push({
        role: msg.fromMe ? 'assistant' : 'user',
        content: msg.text
      });
    }

    // Add current user prompt if not in history
    if (messages.length === 0 || messages[messages.length - 1].content !== incomingText) {
      messages.push({ role: 'user', content: incomingText });
    }

    // Ensure alternating roles starting with user
    const cleanedMessages = [];
    let expectedRole = 'user';
    for (const m of messages) {
      if (m.role === expectedRole) {
        cleanedMessages.push(m);
        expectedRole = expectedRole === 'user' ? 'assistant' : 'user';
      }
    }

    if (cleanedMessages.length === 0) {
      cleanedMessages.push({ role: 'user', content: incomingText });
    }

    const response = await anthropic.messages.create({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: 300,
      system: systemInstruction,
      messages: cleanedMessages
    });

    if (response && response.content && response.content[0] && response.content[0].text) {
      return response.content[0].text.trim();
    }
    return null;
  }

  async generateOpenAI(incomingText, chatHistory, apiKey, model, systemInstruction) {
    const openai = new OpenAI({ apiKey });

    const messages = [{ role: 'system', content: systemInstruction }];
    const recentHistory = chatHistory.slice(-8);

    for (const msg of recentHistory) {
      if (!msg.text || msg.text.startsWith('🗑️')) continue;
      messages.push({
        role: msg.fromMe ? 'assistant' : 'user',
        content: msg.text
      });
    }

    if (messages[messages.length - 1].content !== incomingText) {
      messages.push({ role: 'user', content: incomingText });
    }

    const response = await openai.chat.completions.create({
      model: model || 'gpt-4o-mini',
      messages,
      max_tokens: 300,
      temperature: 0.7
    });

    if (response && response.choices && response.choices[0] && response.choices[0].message) {
      return response.choices[0].message.content.trim();
    }
    return null;
  }

  async generateGemini(incomingText, chatHistory, apiKey, model, systemInstruction) {
    const preferredModel = this.normalizeGeminiModel(model);
    const modelsToTry = [preferredModel];
    if (preferredModel === 'gemini-1.5-flash') modelsToTry.push('gemini-1.5-pro');

    // Build prompt context with conversation memory
    let fullPrompt = incomingText;
    const recentHistory = chatHistory.slice(-6);
    if (recentHistory.length > 0) {
      const historyStr = recentHistory
        .filter(m => m.text && !m.text.startsWith('🗑️'))
        .map(m => `${m.fromMe ? 'Assistant' : 'User'}: ${m.text}`)
        .join('\n');
      fullPrompt = `[Recent Conversation History]:\n${historyStr}\n\nUser: ${incomingText}`;
    }

    for (const modelName of modelsToTry) {
      try {
        const aiClient = new GoogleGenAI({ apiKey });
        const response = await aiClient.models.generateContent({
          model: modelName,
          contents: fullPrompt,
          config: {
            systemInstruction,
            temperature: 0.7,
            maxOutputTokens: 300
          }
        });

        if (response && response.text) {
          return response.text.trim();
        }
      } catch (err) {
        console.error(`Gemini Error (${modelName}):`, err.message);
        logger.log('error', `❌ Gemini Error (${modelName}): ${err.message}`);
      }
    }
    return null;
  }

  async generateStatusDigest(statusList, config) {
    if (!statusList || statusList.length === 0) {
      return "📊 *Status Digest*: No status updates captured today yet.";
    }

    const formattedList = statusList.map((s, idx) => {
      const timeStr = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const text = s.statusText ? ` - "${s.statusText}"` : '';
      return `${idx + 1}. *${s.pushName || s.senderNumber}* (${s.contentType}, ${timeStr})${text}`;
    }).join('\n');

    const prompt = `Below are WhatsApp status updates captured today from contacts:\n\n${formattedList}\n\nPlease create a concise, friendly summary digest (bullet points with key highlights) suitable to send to the phone owner.`;

    const digestText = await this.generateResponse(prompt, [], config);
    if (digestText) {
      return `📊 *Status Digest Summary (${statusList.length} updates today)*:\n\n${digestText}`;
    }

    return `📊 *Status Digest (${statusList.length} updates today)*:\n\n${formattedList}`;
  }

  matchRules(text, rules) {
    if (!text || !Array.isArray(rules)) return null;
    const lowerText = text.toLowerCase().trim();

    for (const rule of rules) {
      if (!rule.trigger || !rule.response) continue;
      const trigger = rule.trigger.toLowerCase().trim();

      if (rule.type === 'exact' && lowerText === trigger) {
        return rule.response;
      } else if (rule.type === 'contains' && lowerText.includes(trigger)) {
        return rule.response;
      } else if (rule.type === 'startsWith' && lowerText.startsWith(trigger)) {
        return rule.response;
      }
    }
    return null;
  }
}

module.exports = new AIService();
