import { createHash } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;

export class ChatOwnershipError extends Error {
  constructor() {
    super('La conversación no existe o pertenece a otra instalación.');
    this.status = 404;
    this.code = 'CHAT_NOT_FOUND';
  }
}

/**
 * Historial de conversaciones y caché de respuestas en SQLite.
 * Cada conversación pertenece a una instalación de la extensión.
 */
export function createChatStore(db) {
  const stmts = {
    getChat: db.prepare('SELECT install_id FROM chats WHERE id = ?'),
    insertChat: db.prepare('INSERT INTO chats (id, install_id, created_at, updated_at) VALUES (?, ?, ?, ?)'),
    touchChat: db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?'),
    insertMessage: db.prepare('INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)'),
    listMessages: db.prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id'),
    getCache: db.prepare('SELECT reply FROM response_cache WHERE key = ? AND created_at >= ?'),
    putCache: db.prepare(`INSERT INTO response_cache (key, reply, created_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET reply = excluded.reply, created_at = excluded.created_at`),
    deleteOldChats: db.prepare('DELETE FROM chats WHERE updated_at < ?'),
    deleteOldCache: db.prepare('DELETE FROM response_cache WHERE created_at < ?'),
    deleteOldUsage: db.prepare('DELETE FROM usage WHERE day < ?'),
  };

  function ensureChat(chatId, installId) {
    const existing = stmts.getChat.get(chatId);
    if (existing && existing.install_id !== installId) throw new ChatOwnershipError();
    if (!existing) {
      const now = Date.now();
      stmts.insertChat.run(chatId, installId, now, now);
    }
  }

  const addMessageTx = db.transaction((chatId, installId, message) => {
    ensureChat(chatId, installId);
    const now = Date.now();
    stmts.insertMessage.run(chatId, message.role, message.content, now);
    stmts.touchChat.run(now, chatId);
    return stmts.listMessages.all(chatId);
  });

  return {
    /** Añade un mensaje y devuelve la conversación completa. */
    addMessage(chatId, installId, message) {
      return addMessageTx(chatId, installId, message);
    },

    getMessages(chatId, installId) {
      const existing = stmts.getChat.get(chatId);
      if (!existing) return [];
      if (existing.install_id !== installId) throw new ChatOwnershipError();
      return stmts.listMessages.all(chatId);
    },

    cacheKey(provider, model, prompt) {
      return createHash('sha256').update(`${provider}\u0000${model}\u0000${prompt}`).digest('hex');
    },

    getCachedReply(key, ttlDays) {
      return stmts.getCache.get(key, Date.now() - ttlDays * DAY_MS)?.reply ?? null;
    },

    cacheReply(key, reply) {
      stmts.putCache.run(key, reply, Date.now());
    },

    /** Borra conversaciones, caché y contadores antiguos. */
    purge({ chatTtlDays, responseCacheTtlDays }) {
      const now = Date.now();
      const chats = stmts.deleteOldChats.run(now - chatTtlDays * DAY_MS).changes;
      const cache = stmts.deleteOldCache.run(now - responseCacheTtlDays * DAY_MS).changes;
      const usageCutoff = new Date(now - 30 * DAY_MS).toISOString().slice(0, 10);
      stmts.deleteOldUsage.run(usageCutoff);
      return { chats, cache };
    },
  };
}
