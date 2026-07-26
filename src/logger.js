const EventEmitter = require('events');

class Logger extends EventEmitter {
  constructor() {
    super();
    this.logs = [];
    this.statusLogs = [];
    this.chatLogs = [];
    this.maxLogs = 100;
  }

  log(type, message, details = {}) {
    const entry = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
      timestamp: new Date().toISOString(),
      type,
      message,
      details
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) this.logs.pop();

    if (type === 'status_view') {
      this.statusLogs.unshift(entry);
      if (this.statusLogs.length > this.maxLogs) this.statusLogs.pop();
    } else if (type === 'auto_reply' || type === 'incoming_message') {
      this.chatLogs.unshift(entry);
      if (this.chatLogs.length > this.maxLogs) this.chatLogs.pop();
    }

    console.log(`[${new Date().toLocaleTimeString()}] [${type.toUpperCase()}] ${message}`);
    this.emit('newLog', entry);
    return entry;
  }

  getLogs() {
    return {
      all: this.logs,
      status: this.statusLogs,
      chat: this.chatLogs
    };
  }
}

module.exports = new Logger();
