import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAiClient } from '../src/services/ai.js';

function fakeProvider(responses) {
  let i = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(responses[Math.min(i++, responses.length - 1)]));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const config = (port) => ({
  provider: 'deepseek', model: '', baseUrl: `http://127.0.0.1:${port}/v1/chat/completions`,
  maxTokens: 100, timeoutMs: 5000, keys: { deepseek: 'k' },
});

test('informa del consumo de cada llamada, incluidos los reintentos', async (t) => {
  const server = await fakeProvider([
    { choices: [{ message: { content: 'cortado' }, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 100, prompt_cache_hit_tokens: 4 } },
    { choices: [{ message: { content: 'completo' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 150 } },
  ]);
  t.after(() => server.close());
  const seen = [];
  const ai = createAiClient(config(server.address().port), { onUsage: (u) => seen.push(u) });
  const reply = await ai.ask('hola', 100, { installId: 'i1', kind: 'prompt' });
  assert.equal(reply, 'completo');
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], { installId: 'i1', kind: 'prompt', provider: 'deepseek', model: 'deepseek-v4-flash', tokens: { input: 10, cached: 4, output: 100 } });
  assert.equal(seen[1].tokens.output, 150);
});
