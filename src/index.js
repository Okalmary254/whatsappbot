const path = require('path');

// Load the repository-root .env regardless of the directory used to launch Node.
// On Render, dashboard environment variables are already present in process.env.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { startServer } = require('./server');
const bot = require('./bot');

console.log('----------------------------------------------------');
console.log('🤖 Starting WhatsApp Groq Personal AI Agent');
console.log('----------------------------------------------------');
console.log('[Groq] GROQ_API_KEY:', process.env.GROQ_API_KEY?.trim() ? 'detected' : 'MISSING');
console.log('[Groq] Model:', process.env.GROQ_MODEL || 'openai/gpt-oss-120b');

// Start Express Web Server
startServer();

// Start WhatsApp Client
bot.start();

// Handle graceful shutdown
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nReceived ' + signal + '; closing WhatsApp connection without logging out...');
  try { await bot.close(); } catch (err) { console.error('Shutdown error:', err.message); }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
