require('dotenv').config();
const { startServer } = require('./server');
const bot = require('./bot');

console.log('----------------------------------------------------');
console.log('🤖 Starting WhatsApp Groq Personal AI Agent');
console.log('----------------------------------------------------');

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
