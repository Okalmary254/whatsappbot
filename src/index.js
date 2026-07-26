require('dotenv').config();
const { startServer } = require('./server');
const bot = require('./bot');

console.log('----------------------------------------------------');
console.log('🤖 Starting WhatsApp Auto Status Viewer & AI Chatbot');
console.log('----------------------------------------------------');

// Start Express Web Server
startServer();

// Start WhatsApp Client
bot.start();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down WhatsApp Bot...');
  await bot.logout();
  process.exit(0);
});
