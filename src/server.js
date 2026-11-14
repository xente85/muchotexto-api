import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { createAiClient } from './services/ai.js';
import { createChatStore } from './services/chatStore.js';
import { createArticleService } from './services/article.js';
import { createConversationService } from './services/conversation.js';
import { createJobQueue } from './services/jobQueue.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const ai = createAiClient(config.ai);
const chatStore = createChatStore(db);

const app = createApp({
  config,
  db,
  ai,
  chatStore,
  articles: createArticleService(config.article),
  conversation: createConversationService({ ai, chatStore, limits: config.limits, retention: config.retention }),
  factCheckJobs: createJobQueue({ maxConcurrent: config.factCheck.maxConcurrent, ttlMs: config.factCheck.jobTtlMs }),
});

function purge() {
  const removed = chatStore.purge(config.retention);
  if (removed.chats || removed.cache) console.log('[db] purge', removed);
}
purge();
const purgeTimer = setInterval(purge, 60 * 60 * 1000);
purgeTimer.unref();

const server = app.listen(config.port, config.host, () => {
  console.log(`[startup] MuchoTexto API en http://${config.host}:${config.port} (${ai.providerName}/${ai.model})`);
  if (!config.ai.keys[ai.providerName]) {
    console.warn(`[startup] Falta la API key de ${ai.providerName}: /prompt devolverá error hasta configurarla.`);
  }
});

function shutdown(signal) {
  console.log(`[shutdown] ${signal}`);
  server.close(() => {
    app.locals.stop?.();
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
