import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createChatStore } from '../src/services/chatStore.js';
import { createConversationService } from '../src/services/conversation.js';
import { createJobQueue } from '../src/services/jobQueue.js';
import { createCostTracker } from '../src/services/costTracker.js';

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
    pricing: { input: 0.14, cachedInput: 0.0028, output: 0.28, searchCall: 0.00075, fetchCall: 0.00075 },
    budget: { dailyUsd: 0, monthlyUsd: 0, ...overrides.budget },
    timeZone: 'Europe/Madrid',
    adminToken: '',
    requireInstallId: true,
    ...overrides.root,
  };
}

/** IA falsa: responde con un contador y anota 1.000 tokens de entrada y 100 de salida. */
export function fakeAi() {
  const calls = [];
  const ai = {
    providerName: 'fake', model: 'fake-1', calls, onUsage: null,
    async chat(messages, _maxTokens, meta = {}) {
      calls.push(messages);
      ai.onUsage?.({ ...meta, provider: 'fake', model: 'fake-1', tokens: { input: 1000, cached: 0, output: 100 } });
      return `respuesta ${calls.length}`;
    },
    async ask(prompt, maxTokens, meta) { return ai.chat([{ role: 'user', content: prompt }], maxTokens, meta); },
  };
  return ai;
}

export async function startTestServer({ config = testConfig(), ai = fakeAi(), articles, runFactCheck } = {}) {
  const db = openDatabase(':memory:');
  const chatStore = createChatStore(db);
  const costs = createCostTracker(db, { pricing: config.pricing, budget: config.budget, timeZone: config.timeZone });
  ai.onUsage = (usage) => costs.record(usage);
  const app = createApp({
    config, db, ai, chatStore, costs,
    articles: articles || { get: async () => ({ title: 't', content: 'c' }) },
    conversation: createConversationService({ ai, chatStore, costs, limits: config.limits, retention: config.retention }),
    factCheckJobs: createJobQueue({ maxConcurrent: 2, ttlMs: 60_000 }),
    runFactCheck,
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method = 'GET', body, installId = INSTALL_A, headers = {} } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(installId ? { 'X-Install-Id': installId } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    ai, db, chatStore, costs, request,
    close: () => new Promise((resolve) => { app.locals.stop(); server.close(() => { db.close(); resolve(); }); }),
  };
}
