const EventEmitter = require('events');

class ChatStore extends EventEmitter {
  constructor() {
    super();
    // Map of jid -> { jid, name, phoneNumber, unreadCount, lastMessage, lastTimestamp, isGroup, hasDeletedMessages }
    this.chats = new Map();
    // Map of jid -> Array<{ id, fromMe, text, timestamp, pushName, isDeleted, deletedAt }>
    this.messages = new Map();
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
      // Keep up to 150 messages per chat in memory
      if (chatMessages.length > 150) {
        chatMessages.shift();
      }
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
    }
  }
}

module.exports = new ChatStore();
