import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, testConfig, INSTALL_B } from './helpers.js';

test('health responde sin identificador', async (t) => {
  const srv = await startTestServer();
  t.after(srv.close);
  const res = await srv.request('/health', { installId: null });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('exige X-Install-Id', async (t) => {
  const srv = await startTestServer();
  t.after(srv.close);
  const res = await srv.request('/prompt', { method: 'POST', installId: null, body: { idChat: 'c1', prompt: 'hola' } });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'INSTALL_ID_REQUIRED');
});

test('conversación: guarda historial y responde', async (t) => {
  const srv = await startTestServer();
  t.after(srv.close);
  let res = await srv.request('/prompt', { method: 'POST', body: { idChat: 'c1', prompt: 'resume esto' } });
  assert.equal(res.status, 200);
  let { chatHistory } = await res.json();
  assert.deepEqual(chatHistory.map((m) => m.role), ['user', 'assistant']);

  res = await srv.request('/prompt', { method: 'POST', body: { idChat: 'c1', prompt: '¿y qué más?' } });
  ({ chatHistory } = await res.json());
  assert.equal(chatHistory.length, 4);
  assert.equal(srv.ai.calls[1].length, 3, 'envía el historial previo al proveedor');
});

test('reutiliza la respuesta de un primer mensaje idéntico', async (t) => {
  const srv = await startTestServer();
  t.after(srv.close);
  await srv.request('/prompt', { method: 'POST', body: { idChat: 'c1', prompt: 'mismo texto' } });
  const res = await srv.request('/prompt', { method: 'POST', body: { idChat: 'c2', prompt: 'mismo texto' } });
  const { chatHistory } = await res.json();
  assert.equal(chatHistory[1].content, 'respuesta 1');
  assert.equal(srv.ai.calls.length, 1);
});

test('otra instalación no puede usar una conversación ajena', async (t) => {
  const srv = await startTestServer();
  t.after(srv.close);
  await srv.request('/prompt', { method: 'POST', body: { idChat: 'c1', prompt: 'privado' } });
  const res = await srv.request('/prompt', { method: 'POST', installId: INSTALL_B, body: { idChat: 'c1', prompt: 'hola' } });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'CHAT_NOT_FOUND');
});

test('un error de la IA no deja mensajes huérfanos', async (t) => {
  const ai = { providerName: 'fake', model: 'x', calls: [], async chat() { throw Object.assign(new Error('caído'), { status: 502, code: 'AI_UPSTREAM_ERROR' }); } };
  const srv = await startTestServer({ ai });
  t.after(srv.close);
  const res = await srv.request('/prompt', { method: 'POST', body: { idChat: 'c1', prompt: 'hola' } });
  assert.equal(res.status, 502);
  assert.deepEqual(srv.chatStore.getMessages('c1', '11111111-1111-4111-8111-111111111111'), []);
});

test('rechaza prompts demasiado largos', async (t) => {
  const srv = await startTestServer();
  t.after(srv.close);
  const res = await srv.request('/prompt', { method: 'POST', body: { idChat: 'c1', prompt: 'x'.repeat(1001) } });
  assert.equal(res.status, 413);
});

test('aplica la cuota diaria', async (t) => {
  const srv = await startTestServer({ config: testConfig({ limits: { dailyQuota: 2 } }) });
  t.after(srv.close);
  for (const n of [1, 2]) {
    const ok = await srv.request('/prompt', { method: 'POST', body: { idChat: `c${n}`, prompt: `p${n}` } });
    assert.equal(ok.status, 200);
  }
  const res = await srv.request('/prompt', { method: 'POST', body: { idChat: 'c3', prompt: 'p3' } });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, 'QUOTA_EXCEEDED');
});

test('aplica el límite por minuto', async (t) => {
  const srv = await startTestServer({ config: testConfig({ limits: { requestsPerMinute: 2 } }) });
  t.after(srv.close);
  await srv.request('/link', { method: 'POST', body: { link: 'https://a.com' } });
  await srv.request('/link', { method: 'POST', body: { link: 'https://a.com' } });
  const res = await srv.request('/link', { method: 'POST', body: { link: 'https://a.com' } });
  assert.equal(res.status, 429);
});

test('fact-check: trabajo en segundo plano con propietario', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const runFactCheck = async ({ idChat, installId, chatStore }) => {
    await gate;
    chatStore.addMessage(idChat, installId, { role: 'user', content: 'ctx' });
    return { chatHistory: chatStore.addMessage(idChat, installId, { role: 'assistant', content: 'informe' }) };
  };
  const srv = await startTestServer({ runFactCheck });
  t.after(srv.close);

  const start = await srv.request('/fact-check', { method: 'POST', body: { idChat: 'f1', article: { title: 't', content: 'c' } } });
  assert.equal(start.status, 202);
  const { jobId } = await start.json();

  assert.equal((await srv.request(`/fact-check/${jobId}`, { installId: INSTALL_B })).status, 404);
  assert.equal((await srv.request(`/fact-check/${jobId}`)).status, 202);

  release();
  await new Promise((r) => setTimeout(r, 20));
  const done = await srv.request(`/fact-check/${jobId}`);
  assert.equal(done.status, 200);
  assert.equal((await done.json()).chatHistory.at(-1).content, 'informe');
  assert.equal((await srv.request(`/fact-check/${jobId}`)).status, 404, 'se borra tras leerse');
});

test('errores de artículo devuelven código para el fallback del navegador', async (t) => {
  const articles = { get: async () => { throw Object.assign(new Error('protegido'), { status: 422, code: 'ARTICLE_PROTECTED' }); } };
  const srv = await startTestServer({ articles });
  t.after(srv.close);
  const res = await srv.request('/link', { method: 'POST', body: { link: 'https://a.com' } });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, 'ARTICLE_PROTECTED');
});
