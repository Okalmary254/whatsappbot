const { GoogleGenAI } = require('@google/genai');
const logger = require('./logger');

class AIService {
  normalizeModel(model) {
    if (!model || model === 'gemini-2.5-flash') {
      return 'gemini-2.0-flash';
    }
    return model;
  }

  async generateResponse(incomingText, chatHistory = [], config) {
    const aiConfig = config.ai || {};
    const rules = config.rules || [];
    const mode = config.bot?.replyMode || "ai";

    const apiKey = (aiConfig.geminiApiKey && aiConfig.geminiApiKey.trim() !== '') 
      ? aiConfig.geminiApiKey.trim() 
      : (process.env.GEMINI_API_KEY || '').trim();

    // If mode is "rules" or no AI key provided, try rule matching first
    if (mode === "rules" || !apiKey) {
      if (!apiKey && mode !== "rules") {
        logger.log('system', '⚠️ AI mode active but no Gemini API Key provided. Falling back to keyword rules.');
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

    // Try AI generation via Gemini
    if (apiKey) {
      const preferredModel = this.normalizeModel(aiConfig.model);
      const modelsToTry = [preferredModel];
      
      // Auto fallback to alternative model if rate limit / quota hit
      if (preferredModel === 'gemini-2.0-flash') {
        modelsToTry.push('gemini-2.0-flash-lite');
      } else if (preferredModel === 'gemini-2.0-flash-lite') {
        modelsToTry.push('gemini-2.0-flash');
      }

      const prompt = incomingText;
      const systemInstruction = aiConfig.systemInstructions && aiConfig.systemInstructions.trim() !== ''
        ? aiConfig.systemInstructions.trim()
        : "You are a polite, helpful WhatsApp assistant. Reply concisely and conversationally. Keep answers short and appropriate for instant messaging.";

      for (let i = 0; i < modelsToTry.length; i++) {
        const modelName = modelsToTry[i];
        try {
          const aiClient = new GoogleGenAI({ apiKey });

          const response = await aiClient.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              systemInstruction,
              temperature: 0.7,
              maxOutputTokens: 300
            }
          });

          if (response && response.text) {
            return response.text.trim();
          } else {
            logger.log('error', `Gemini AI (${modelName}) returned empty response text.`);
          }
        } catch (err) {
          let errMessage = err.message || err.toString();
          try {
            if (typeof errMessage === 'string' && errMessage.startsWith('{')) {
              const parsed = JSON.parse(errMessage);
              errMessage = parsed.error?.message || errMessage;
            }
          } catch (e) {}

          const isQuotaError = errMessage.includes('Quota exceeded') || errMessage.includes('429') || errMessage.includes('RESOURCE_EXHAUSTED') || errMessage.includes('rate-limits');

          if (isQuotaError && i < modelsToTry.length - 1) {
            logger.log('system', `⚠️ ${modelName} rate limit hit. Automatically retrying with ${modelsToTry[i + 1]}...`);
            continue;
          }

          console.error(`AI Generation Error (${modelName}):`, errMessage);
          logger.log('error', `❌ Gemini AI Error (${modelName}): ${errMessage}`);
          break;
        }
      }

      // Fallback to rule matching if AI fails or quota is exhausted
      const ruleMatch = this.matchRules(incomingText, rules);
      if (ruleMatch) return ruleMatch;
    }

    // Final fallback rule check
    return this.matchRules(incomingText, rules);
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
