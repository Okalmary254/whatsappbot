const path = require('path');

// Load the repository-root .env regardless of the directory used to launch Node.
// On Render, dashboard environment variables are already present in process.env.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { startServer } = require('./server');
const bot = require('./bot');
const tenantBotManager = require('./tenantBotManager');
const tenantPortal = require('./tenantPortal');

console.log('----------------------------------------------------');
console.log('🤖 Starting WhatsApp Groq Personal AI Agent');
console.log('----------------------------------------------------');
console.log('[Groq] GROQ_API_KEY:', process.env.GROQ_API_KEY?.trim() ? 'detected' : 'MISSING');
console.log('[Groq] Model:', process.env.GROQ_MODEL || 'openai/gpt-oss-120b');

// Start Express Web Server
startServer();

// Start each account's own WhatsApp session when persistent credentials exist.
tenantPortal.ensureSchema()
  .then(() => tenantBotManager.startExistingSessions())
  .catch((err) => {
    console.error('[Whatsy] Could not initialize account sessions:', err.message);
  });

// Keep the previous single-account dashboard available only when explicitly enabled.
if (process.env.ENABLE_LEGACY_BOT === 'true') bot.start();

// Handle graceful shutdown
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nReceived ' + signal + '; closing WhatsApp connection without logging out...');
  try { await tenantBotManager.closeAll(); } catch (err) { console.error('Tenant shutdown error:', err.message); }
  try { await bot.close(); } catch (err) { console.error('Legacy bot shutdown error:', err.message); }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
