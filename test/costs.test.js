import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { costOf, createCostTracker, dayKey, readUsage } from '../src/services/costTracker.js';
import { startTestServer, testConfig } from './helpers.js';

const pricing = { input: 0.14, cachedInput: 0.0028, output: 0.28, searchCall: 0.00075, fetchCall: 0.00075 };

test('lee los tokens de DeepSeek, OpenAI y Kimi', () => {
  assert.deepEqual(readUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 40 }), { input: 100, cached: 40, output: 20 });
  assert.deepEqual(readUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 10 } }), { input: 100, cached: 10, output: 20 });
  assert.deepEqual(readUsage({ prompt_tokens: 100, completion_tokens: 20, cached_tokens: 5 }), { input: 100, cached: 5, output: 20 });
  assert.deepEqual(readUsage(undefined), { input: 0, cached: 0, output: 0 });
});

test('calcula el coste con caché y búsquedas', () => {
  // 1M de entrada (la mitad en caché) + 1M de salida + 2 búsquedas
  const cost = costOf({ input: 1e6, cached: 5e5, output: 1e6, search: 2 }, pricing);
  assert.equal(cost.toFixed(6), (0.07 + 0.0014 + 0.28 + 0.0015).toFixed(6));
});

test('los días usan la zona horaria configurada', () => {
  const t = Date.UTC(2026, 10, 14, 23, 30); // 00:30 del 15 en Madrid
  assert.equal(dayKey(t, 'Europe/Madrid'), '2026-11-15');
  assert.equal(dayKey(t, 'UTC'), '2026-11-14');
});

test('límite diario de gasto', () => {
  const db = openDatabase(':memory:');
  const costs = createCostTracker(db, { pricing, budget: { dailyUsd: 0.01, monthlyUsd: 0 }, timeZone: 'UTC' });
  costs.record({ installId: 'a', kind: 'prompt', provider: 'p', model: 'm', tokens: { input: 50_000, output: 0 } });
  assert.doesNotThrow(() => costs.assertWithinBudget());
  costs.record({ installId: 'a', kind: 'prompt', provider: 'p', model: 'm', tokens: { input: 50_000, output: 0 } });
  assert.throws(() => costs.assertWithinBudget(), (e) => e.code === 'BUDGET_EXCEEDED');
  db.close();
});

test('registra el consumo de /prompt y no cobra las respuestas reutilizadas', async (t) => {
  const srv = await startTestServer();
  t.after(srv.close);
  await srv.request('/prompt', { method: 'POST', body: { idChat: 'c1', prompt: 'igual' } });
  await srv.request('/prompt', { method: 'POST', body: { idChat: 'c2', prompt: 'igual' } });
  const { totals } = srv.costs.report();
  assert.equal(totals.today.calls, 2);
  assert.equal(totals.today.cacheHits, 1);
  assert.equal(totals.today.input, 1000);
  assert.ok(Math.abs(totals.today.cost - (1000 * 0.14 + 100 * 0.28) / 1e6) < 1e-12);
});

test('bloquea /prompt al superar el presupuesto', async (t) => {
  const srv = await startTestServer({ config: testConfig({ budget: { dailyUsd: 0.0001 } }) });
  t.after(srv.close);
  assert.equal((await srv.request('/prompt', { method: 'POST', body: { idChat: 'c1', prompt: 'a' } })).status, 200);
  const res = await srv.request('/prompt', { method: 'POST', body: { idChat: 'c2', prompt: 'b' } });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, 'BUDGET_EXCEEDED');
});

test('/admin muestra el consumo desde la propia máquina', async (t) => {
  const srv = await startTestServer();
  t.after(srv.close);
  await srv.request('/prompt', { method: 'POST', body: { idChat: 'c1', prompt: 'hola' } });
  const page = await srv.request('/admin', { installId: null });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Consumo de la IA/);
  assert.match(html, /fake \/ fake-1/);
  const json = await (await srv.request('/admin/usage.json', { installId: null })).json();
  assert.equal(json.totals.all.calls, 1);
});

test('/admin exige ADMIN_TOKEN cuando está configurado', async (t) => {
  const srv = await startTestServer({ config: testConfig({ root: { adminToken: 'secreto' } }) });
  t.after(srv.close);
  assert.equal((await srv.request('/admin', { installId: null })).status, 401);
  assert.equal((await srv.request('/admin?token=malo', { installId: null })).status, 401);
  assert.equal((await srv.request('/admin?token=secreto', { installId: null })).status, 200);
  assert.equal((await srv.request('/admin/usage.json', { installId: null, headers: { Authorization: 'Bearer secreto' } })).status, 200);
});
