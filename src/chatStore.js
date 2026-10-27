const EventEmitter = require('events');
const { run, all, ready } = require('./db');

const RETENTION_DAYS = Math.max(1, Number(process.env.MESSAGE_RETENTION_DAYS) || 30);
const MAX_MESSAGES_PER_CHAT = Math.max(100, Number(process.env.MAX_MESSAGES_PER_CHAT) || 500);

class ChatStore extends EventEmitter {
  constructor() {
    super();
    this.chats = new Map();
    this.messages = new Map();
    this.statusViews = [];
    this.loadPromise = this.loadFromDb();
    this.loadPromise.catch((err) => {
      console.error('Error loading ChatStore from PostgreSQL:', err);
    });
  }

  async loadFromDb() {
    await ready;
    const retentionCutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

    await run('DELETE FROM messages WHERE timestamp < ?', [retentionCutoff]);

    const dbChats = await all('SELECT * FROM chats ORDER BY last_timestamp DESC NULLS LAST');
    for (const c of dbChats) {
      this.chats.set(c.jid, {
        jid: c.jid,
        name: c.name,
        phoneNumber: c.phone_number,
        unreadCount: c.unread_count || 0,
        lastMessage: c.last_message,
        lastTimestamp: c.last_timestamp == null ? null : Number(c.last_timestamp),
        isGroup: Boolean(c.is_group),
        hasDeletedMessages: Boolean(c.has_deleted_messages),
      });
    }

    const dbMsgs = await all(
      'SELECT * FROM messages WHERE timestamp >= ? ORDER BY timestamp ASC',
      [retentionCutoff]
    );

    for (const m of dbMsgs) {
      if (!this.messages.has(m.jid)) this.messages.set(m.jid, []);
      const list = this.messages.get(m.jid);
      list.push({
        id: m.id,
        fromMe: Boolean(m.from_me),
        text: m.text,
        timestamp: Number(m.timestamp),
        pushName: m.push_name,
        isDeleted: Boolean(m.is_deleted),
        deletedAt: m.deleted_at == null ? null : Number(m.deleted_at),
      });
      if (list.length > MAX_MESSAGES_PER_CHAT) {
        list.splice(0, list.length - MAX_MESSAGES_PER_CHAT);
      }
    }

    const dbStatuses = await all(
      'SELECT * FROM status_views ORDER BY timestamp DESC LIMIT 200'
    );
    this.statusViews = dbStatuses.map((s) => ({
      id: s.id,
      jid: s.jid,
      pushName: s.push_name,
      senderNumber: s.sender_number,
      contentType: s.content_type,
      statusText: s.status_text,
      timestamp: Number(s.timestamp),
      messageId: s.message_id,
    }));

    console.log(
      `Loaded ${this.chats.size} chats, ${dbMsgs.length} messages, and ${this.statusViews.length} status views from PostgreSQL.`
    );
  }

  addMessage({ jid, id, fromMe, text, pushName, timestamp, isGroup = false }) {
    if (!jid || !text) return null;

    const cleanJid = jid.trim();
    if (cleanJid === 'status@broadcast') return null;

    const phoneNumber = cleanJid.split('@')[0];
    const messageTime = timestamp
      ? (typeof timestamp === 'number'
        ? (timestamp > 1e11 ? timestamp : timestamp * 1000)
        : Date.parse(timestamp))
      : Date.now();
    const name = pushName || phoneNumber;

    const existingChat = this.chats.get(cleanJid) || {
      jid: cleanJid,
      name,
      phoneNumber,
      unreadCount: 0,
      lastMessage: text,
      lastTimestamp: messageTime,
      isGroup: Boolean(isGroup),
      hasDeletedMessages: false,
    };

    existingChat.lastMessage = text;
    existingChat.lastTimestamp = messageTime;
    existingChat.isGroup = Boolean(existingChat.isGroup || isGroup);
    if (pushName && pushName !== phoneNumber) existingChat.name = pushName;
    if (!fromMe) existingChat.unreadCount = (existingChat.unreadCount || 0) + 1;
    this.chats.set(cleanJid, existingChat);

    run(`
      INSERT INTO chats
        (jid, name, phone_number, unread_count, last_message, last_timestamp, is_group, has_deleted_messages)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (jid) DO UPDATE SET
        name = EXCLUDED.name,
        phone_number = EXCLUDED.phone_number,
        unread_count = EXCLUDED.unread_count,
        last_message = EXCLUDED.last_message,
        last_timestamp = EXCLUDED.last_timestamp,
        is_group = EXCLUDED.is_group,
        has_deleted_messages = EXCLUDED.has_deleted_messages
    `, [
      existingChat.jid,
      existingChat.name,
      existingChat.phoneNumber,
      existingChat.unreadCount,
      existingChat.lastMessage,
      existingChat.lastTimestamp,
      existingChat.isGroup,
      existingChat.hasDeletedMessages,
    ]).catch((err) => console.error('Error saving chat to PostgreSQL:', err));

    if (!this.messages.has(cleanJid)) this.messages.set(cleanJid, []);
    const chatMessages = this.messages.get(cleanJid);
    const msgObj = {
      id: id || `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      fromMe: Boolean(fromMe),
      text,
      timestamp: messageTime,
      pushName: name,
      isDeleted: false,
      deletedAt: null,
    };

    if (!chatMessages.some((m) => m.id === msgObj.id)) {
      chatMessages.push(msgObj);
      if (chatMessages.length > MAX_MESSAGES_PER_CHAT) {
        chatMessages.splice(0, chatMessages.length - MAX_MESSAGES_PER_CHAT);
      }

      run(`
        INSERT INTO messages (id, jid, from_me, text, timestamp, push_name, is_deleted, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, FALSE, NULL)
        ON CONFLICT (id) DO NOTHING
      `, [
        msgObj.id,
        cleanJid,
        msgObj.fromMe,
        msgObj.text,
        msgObj.timestamp,
        msgObj.pushName,
      ]).catch((err) => console.error('Error saving message to PostgreSQL:', err));
    }

    this.emit('chatUpdated', { chat: existingChat, message: msgObj });
    return { chat: existingChat, message: msgObj };
  }

  handleRevokeMessage({ remoteJid, targetId, revokeTimestamp }) {
    if (!remoteJid || !targetId) return null;

    const cleanJid = remoteJid.trim();
    if (!this.messages.has(cleanJid)) this.messages.set(cleanJid, []);
    const chatMessages = this.messages.get(cleanJid);
    let revokedMsg = chatMessages.find((m) => m.id === targetId);
    const now = revokeTimestamp || Date.now();

    if (revokedMsg) {
      revokedMsg.isDeleted = true;
      revokedMsg.deletedAt = now;
    } else {
      const phoneNumber = cleanJid.split('@')[0];
      revokedMsg = {
        id: targetId,
        fromMe: false,
        text: '[Message was deleted by sender before bot captured text]',
        timestamp: now,
        pushName: phoneNumber,
        isDeleted: true,
        deletedAt: now,
      };
      chatMessages.push(revokedMsg);
    }

    run(`
      INSERT INTO messages (id, jid, from_me, text, timestamp, push_name, is_deleted, deleted_at)
      VALUES (?, ?, FALSE, ?, ?, ?, TRUE, ?)
      ON CONFLICT (id) DO UPDATE SET
        is_deleted = TRUE,
        deleted_at = EXCLUDED.deleted_at
    `, [
      revokedMsg.id,
      cleanJid,
      revokedMsg.text,
      revokedMsg.timestamp,
      revokedMsg.pushName,
      now,
    ]).catch((err) => console.error('Error updating revoked message in PostgreSQL:', err));

    const chat = this.chats.get(cleanJid) || {
      jid: cleanJid,
      name: cleanJid.split('@')[0],
      phoneNumber: cleanJid.split('@')[0],
      unreadCount: 0,
      lastMessage: '',
      lastTimestamp: now,
      isGroup: cleanJid.endsWith('@g.us'),
      hasDeletedMessages: true,
    };

    chat.hasDeletedMessages = true;
    chat.lastMessage = `🗑️ [Deleted Restored]: "${revokedMsg.text}"`;
    chat.lastTimestamp = now;
    this.chats.set(cleanJid, chat);

    run(`
      INSERT INTO chats
        (jid, name, phone_number, unread_count, last_message, last_timestamp, is_group, has_deleted_messages)
      VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
      ON CONFLICT (jid) DO UPDATE SET
        last_message = EXCLUDED.last_message,
        last_timestamp = EXCLUDED.last_timestamp,
        has_deleted_messages = TRUE
    `, [
      chat.jid,
      chat.name,
      chat.phoneNumber,
      chat.unreadCount,
      chat.lastMessage,
      chat.lastTimestamp,
      chat.isGroup,
    ]).catch((err) => console.error('Error updating chat revoke state in PostgreSQL:', err));

    this.emit('chatUpdated', { chat, message: revokedMsg });
    this.emit('messageRevoked', { jid: cleanJid, chat, message: revokedMsg });
    return { chat, message: revokedMsg };
  }

  saveStatusView({ id, jid, pushName, senderNumber, contentType, statusText, timestamp, messageId }) {
    const entry = {
      id: id || `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      jid,
      pushName: pushName || senderNumber,
      senderNumber,
      contentType: contentType || 'Text',
      statusText: statusText || '',
      timestamp: timestamp || Date.now(),
      messageId,
    };

    this.statusViews.unshift(entry);
    if (this.statusViews.length > 300) this.statusViews.pop();

    run(`
      INSERT INTO status_views
        (id, jid, push_name, sender_number, content_type, status_text, timestamp, message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING
    `, [
      entry.id,
      entry.jid,
      entry.pushName,
      entry.senderNumber,
      entry.contentType,
      entry.statusText,
      entry.timestamp,
      entry.messageId,
    ]).catch((err) => console.error('Error saving status view to PostgreSQL:', err));

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
    return this.statusViews.filter((s) => Number(s.timestamp) >= startTimestamp);
  }

  getDeletedMessages() {
    const deletedList = [];
    for (const [jid, msgList] of this.messages.entries()) {
      msgList.forEach((msg) => {
        if (msg.isDeleted) {
          deletedList.push({ ...msg, jid, phoneNumber: jid.split('@')[0] });
        }
      });
    }
    deletedList.sort(
      (a, b) => (Number(b.deletedAt || b.timestamp) - Number(a.deletedAt || a.timestamp))
    );
    return deletedList;
  }

  getChats() {
    return Array.from(this.chats.values()).sort(
      (a, b) => Number(b.lastTimestamp || 0) - Number(a.lastTimestamp || 0)
    );
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
      run('UPDATE chats SET unread_count = 0 WHERE jid = ?', [cleanJid])
        .catch(() => {});
    }
  }
}

module.exports = new ChatStore();
