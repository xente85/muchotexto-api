import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createChatStore } from '../src/services/chatStore.js';
import { createConversationService } from '../src/services/conversation.js';
import { createJobQueue } from '../src/services/jobQueue.js';

export const INSTALL_A = '11111111-1111-4111-8111-111111111111';
export const INSTALL_B = '22222222-2222-4222-8222-222222222222';

export function testConfig(overrides = {}) {
  return {
    ai: { keys: { deepseek: 'test-key' } },
    limits: {
      maxPromptChars: 1000, maxChatMessages: 4, requestsPerMinute: 100,
      dailyQuota: 100, factCheckDailyQuota: 100, ...overrides.limits,
    },
    retention: { chatTtlDays: 7, responseCacheTtlDays: 7 },
    requireInstallId: true,
    ...overrides.root,
  };
}

/** IA falsa que responde con el número de mensajes recibidos. */
export function fakeAi() {
  const calls = [];
  return {
    providerName: 'fake', model: 'fake-1', calls,
    async chat(messages) { calls.push(messages); return `respuesta ${calls.length}`; },
    async ask(prompt) { return this.chat([{ role: 'user', content: prompt }]); },
  };
}

export async function startTestServer({ config = testConfig(), ai = fakeAi(), articles, runFactCheck } = {}) {
  const db = openDatabase(':memory:');
  const chatStore = createChatStore(db);
  const app = createApp({
    config, db, ai, chatStore,
    articles: articles || { get: async () => ({ title: 't', content: 'c' }) },
    conversation: createConversationService({ ai, chatStore, limits: config.limits, retention: config.retention }),
    factCheckJobs: createJobQueue({ maxConcurrent: 2, ttlMs: 60_000 }),
    runFactCheck,
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method = 'GET', body, installId = INSTALL_A } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(installId ? { 'X-Install-Id': installId } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    ai, db, chatStore, request,
    close: () => new Promise((resolve) => { app.locals.stop(); server.close(() => { db.close(); resolve(); }); }),
  };
}
