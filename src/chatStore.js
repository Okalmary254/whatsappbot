const EventEmitter = require('events');
const { run, all, get } = require('./db');

class ChatStore extends EventEmitter {
  constructor() {
    super();
    // Map of jid -> { jid, name, phoneNumber, unreadCount, lastMessage, lastTimestamp, isGroup, hasDeletedMessages }
    this.chats = new Map();
    // Map of jid -> Array<{ id, fromMe, text, timestamp, pushName, isDeleted, deletedAt }>
    this.messages = new Map();
    // Array of status view logs
    this.statusViews = [];

    // Load persisted state from DB
    this.loadFromDb().catch(err => console.error('Error loading ChatStore from DB:', err));
  }

  async loadFromDb() {
    try {
      // Load chats
      const dbChats = await all(`SELECT * FROM chats ORDER BY lastTimestamp DESC`);
      for (const c of dbChats) {
        this.chats.set(c.jid, {
          jid: c.jid,
          name: c.name,
          phoneNumber: c.phoneNumber,
          unreadCount: c.unreadCount || 0,
          lastMessage: c.lastMessage,
          lastTimestamp: c.lastTimestamp,
          isGroup: Boolean(c.isGroup),
          hasDeletedMessages: Boolean(c.hasDeletedMessages)
        });
      }

      // Load messages
      const dbMsgs = await all(`SELECT * FROM messages ORDER BY timestamp ASC`);
      for (const m of dbMsgs) {
        if (!this.messages.has(m.jid)) {
          this.messages.set(m.jid, []);
        }
        const list = this.messages.get(m.jid);
        list.push({
          id: m.id,
          fromMe: Boolean(m.fromMe),
          text: m.text,
          timestamp: m.timestamp,
          pushName: m.pushName,
          isDeleted: Boolean(m.isDeleted),
          deletedAt: m.deletedAt
        });
      }

      // Load status views
      const dbStatuses = await all(`SELECT * FROM status_views ORDER BY timestamp DESC LIMIT 200`);
      this.statusViews = dbStatuses.map(s => ({
        id: s.id,
        jid: s.jid,
        pushName: s.pushName,
        senderNumber: s.senderNumber,
        contentType: s.contentType,
        statusText: s.statusText,
        timestamp: s.timestamp,
        messageId: s.messageId
      }));

      console.log(`💾 Loaded ${this.chats.size} chats, ${dbMsgs.length} messages, and ${this.statusViews.length} status views from DB.`);
    } catch (err) {
      console.error('Error loading data from SQLite DB:', err);
    }
  }

  addMessage({ jid, id, fromMe, text, pushName, timestamp, isGroup = false }) {
    if (!jid || !text) return null;

    const cleanJid = jid.trim();
    if (cleanJid === 'status@broadcast') return null;

    const phoneNumber = cleanJid.split('@')[0];
    const messageTime = timestamp ? (typeof timestamp === 'number' ? (timestamp > 1e11 ? timestamp : timestamp * 1000) : Date.parse(timestamp)) : Date.now();
    const name = pushName || phoneNumber;

    // Update or create chat entry
    const existingChat = this.chats.get(cleanJid) || {
      jid: cleanJid,
      name: name,
      phoneNumber: phoneNumber,
      unreadCount: 0,
      lastMessage: text,
      lastTimestamp: messageTime,
      isGroup: Boolean(isGroup),
      hasDeletedMessages: false
    };

    existingChat.lastMessage = text;
    existingChat.lastTimestamp = messageTime;
    if (pushName && pushName !== phoneNumber) {
      existingChat.name = pushName;
    }

    if (!fromMe) {
      existingChat.unreadCount = (existingChat.unreadCount || 0) + 1;
    }

    this.chats.set(cleanJid, existingChat);

    // Save chat to DB
    run(`
      INSERT INTO chats (jid, name, phoneNumber, unreadCount, lastMessage, lastTimestamp, isGroup, hasDeletedMessages)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        unreadCount = excluded.unreadCount,
        lastMessage = excluded.lastMessage,
        lastTimestamp = excluded.lastTimestamp,
        hasDeletedMessages = excluded.hasDeletedMessages
    `, [
      existingChat.jid,
      existingChat.name,
      existingChat.phoneNumber,
      existingChat.unreadCount,
      existingChat.lastMessage,
      existingChat.lastTimestamp,
      existingChat.isGroup ? 1 : 0,
      existingChat.hasDeletedMessages ? 1 : 0
    ]).catch(e => console.error('Error saving chat to DB:', e));

    // Add to message history
    if (!this.messages.has(cleanJid)) {
      this.messages.set(cleanJid, []);
    }

    const chatMessages = this.messages.get(cleanJid);
    const msgObj = {
      id: id || Date.now().toString() + Math.random().toString(36).substr(2, 4),
      fromMe: Boolean(fromMe),
      text: text,
      timestamp: messageTime,
      pushName: name,
      isDeleted: false,
      deletedAt: null
    };

    // Avoid duplicate message IDs
    if (!chatMessages.some(m => m.id === msgObj.id)) {
      chatMessages.push(msgObj);
      if (chatMessages.length > 200) {
        chatMessages.shift();
      }

      // Save message to DB
      run(`
        INSERT INTO messages (id, jid, fromMe, text, timestamp, pushName, isDeleted, deletedAt)
        VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
        ON CONFLICT(id) DO NOTHING
      `, [
        msgObj.id,
        cleanJid,
        msgObj.fromMe ? 1 : 0,
        msgObj.text,
        msgObj.timestamp,
        msgObj.pushName
      ]).catch(e => console.error('Error saving message to DB:', e));
    }

    // Emit real-time event
    this.emit('chatUpdated', {
      chat: existingChat,
      message: msgObj
    });

    return { chat: existingChat, message: msgObj };
  }

  handleRevokeMessage({ remoteJid, targetId, revokeTimestamp }) {
    if (!remoteJid || !targetId) return null;

    const cleanJid = remoteJid.trim();
    if (!this.messages.has(cleanJid)) {
      this.messages.set(cleanJid, []);
    }

    const chatMessages = this.messages.get(cleanJid);
    let revokedMsg = chatMessages.find(m => m.id === targetId);

    const now = revokeTimestamp || Date.now();

    if (revokedMsg) {
      revokedMsg.isDeleted = true;
      revokedMsg.deletedAt = now;
    } else {
      // Create a placeholder for revoked message if original was deleted before bot recorded text
      const phoneNumber = cleanJid.split('@')[0];
      revokedMsg = {
        id: targetId,
        fromMe: false,
        text: '[Message was deleted by sender before bot captured text]',
        timestamp: now,
        pushName: phoneNumber,
        isDeleted: true,
        deletedAt: now
      };
      chatMessages.push(revokedMsg);
    }

    // Update in DB
    run(`
      INSERT INTO messages (id, jid, fromMe, text, timestamp, pushName, isDeleted, deletedAt)
      VALUES (?, ?, 0, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET isDeleted = 1, deletedAt = excluded.deletedAt
    `, [
      revokedMsg.id,
      cleanJid,
      revokedMsg.text,
      revokedMsg.timestamp,
      revokedMsg.pushName,
      now
    ]).catch(e => console.error('Error updating revoked message in DB:', e));

    const chat = this.chats.get(cleanJid) || {
      jid: cleanJid,
      name: cleanJid.split('@')[0],
      phoneNumber: cleanJid.split('@')[0],
      unreadCount: 0,
      lastMessage: `🗑️ Restored Message: "${revokedMsg.text}"`,
      lastTimestamp: now,
      isGroup: cleanJid.endsWith('@g.us'),
      hasDeletedMessages: true
    };

    chat.hasDeletedMessages = true;
    chat.lastMessage = `🗑️ [Deleted Restored]: "${revokedMsg.text}"`;
    chat.lastTimestamp = now;
    this.chats.set(cleanJid, chat);

    run(`
      INSERT INTO chats (jid, name, phoneNumber, unreadCount, lastMessage, lastTimestamp, isGroup, hasDeletedMessages)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(jid) DO UPDATE SET
        lastMessage = excluded.lastMessage,
        lastTimestamp = excluded.lastTimestamp,
        hasDeletedMessages = 1
    `, [
      chat.jid,
      chat.name,
      chat.phoneNumber,
      chat.unreadCount,
      chat.lastMessage,
      chat.lastTimestamp,
      chat.isGroup ? 1 : 0
    ]).catch(e => console.error('Error updating chat revoke state in DB:', e));

    this.emit('chatUpdated', {
      chat,
      message: revokedMsg
    });

    this.emit('messageRevoked', {
      jid: cleanJid,
      chat,
      message: revokedMsg
    });

    return { chat, message: revokedMsg };
  }

  saveStatusView({ id, jid, pushName, senderNumber, contentType, statusText, timestamp, messageId }) {
    const entry = {
      id: id || Date.now().toString() + Math.random().toString(36).substr(2, 4),
      jid,
      pushName: pushName || senderNumber,
      senderNumber,
      contentType: contentType || 'Text',
      statusText: statusText || '',
      timestamp: timestamp || Date.now(),
      messageId
    };

    this.statusViews.unshift(entry);
    if (this.statusViews.length > 300) {
      this.statusViews.pop();
    }

    run(`
      INSERT INTO status_views (id, jid, pushName, senderNumber, contentType, statusText, timestamp, messageId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `, [
      entry.id,
      entry.jid,
      entry.pushName,
      entry.senderNumber,
      entry.contentType,
      entry.statusText,
      entry.timestamp,
      entry.messageId
    ]).catch(e => console.error('Error saving status view to DB:', e));

    this.emit('statusViewed', entry);
    return entry;
  }

  getStatusViews(limit = 50) {
    return this.statusViews.slice(0, limit);
  }

  getTodayStatusViews() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTimestamp = startOfDay.getTime();

    return this.statusViews.filter(s => s.timestamp >= startTimestamp);
  }

  getDeletedMessages() {
    const deletedList = [];
    for (const [jid, msgList] of this.messages.entries()) {
      msgList.forEach(msg => {
        if (msg.isDeleted) {
          deletedList.push({
            ...msg,
            jid,
            phoneNumber: jid.split('@')[0]
          });
        }
      });
    }
    deletedList.sort((a, b) => (b.deletedAt || b.timestamp) - (a.deletedAt || a.timestamp));
    return deletedList;
  }

  getChats() {
    const list = Array.from(this.chats.values());
    list.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    return list;
  }

  getMessages(jid) {
    if (!jid) return [];
    const cleanJid = jid.trim();
    this.markAsRead(cleanJid);
    return this.messages.get(cleanJid) || [];
  }

  markAsRead(jid) {
    if (!jid) return;
    const cleanJid = jid.trim();
    if (this.chats.has(cleanJid)) {
      const chat = this.chats.get(cleanJid);
      chat.unreadCount = 0;
      this.chats.set(cleanJid, chat);
      run(`UPDATE chats SET unreadCount = 0 WHERE jid = ?`, [cleanJid]).catch(() => {});
    }
  }
}

module.exports = new ChatStore();
