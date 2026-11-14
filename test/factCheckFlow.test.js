import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { factCheckArticle } from '../src/services/factCheck.js';
import { openDatabase } from '../src/db.js';
import { createChatStore } from '../src/services/chatStore.js';
import { createCostTracker } from '../src/services/costTracker.js';

const pad = (text, seed) => `${text}\n${Array.from({ length: 12 }, (_, i) => `${seed} ${i} ${seed.repeat(2)} detalle adicional ${i * 7} ${seed}x`).join('\n')}`;

function fakeTools() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const data = JSON.parse(body);
      calls.push({ path: req.url, ...data });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/search') {
        const official = data.query.includes('INE');
        res.end(JSON.stringify({ results: official
          ? [{ url: 'https://www.ine.es/epa', title: 'EPA INE', content: pad('El INE confirma que la tasa de paro fue del 11,2 % en el tercer trimestre.', 'ine') }]
          : [
            { url: 'https://periodico.com/paro', title: 'Paro', content: pad('Según la EPA, la tasa de paro fue del 11,2 % en el tercer trimestre.', 'per') },
            { url: 'https://sincontenido.com/x', title: 'Sin contenido', content: '' },
          ] }));
      } else {
        res.end(JSON.stringify({ title: 'Recuperada', content: pad('Los datos oficiales sitúan la tasa de paro en el 11,2 % en el tercer trimestre.', 'rec') }));
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls })));
}

test('flujo completo: dos búsquedas, lectura de respaldo, validación e informe', async (t) => {
  const { server, calls } = await fakeTools();
  t.after(() => server.close());
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const chatStore = createChatStore(db);
  const costs = createCostTracker(db, {
    pricing: { input: 0.14, cachedInput: 0.0028, output: 0.28, searchCall: 0.00075, fetchCall: 0.00075 },
    budget: { dailyUsd: 0, monthlyUsd: 0 }, timeZone: 'UTC',
  });

  const prompts = [];
  const ai = {
    async ask(prompt, _max, meta) {
      prompts.push(prompt);
      costs.record({ ...meta, provider: 'fake', model: 'f', tokens: { input: 1000, output: 100 } });
      if (prompt.startsWith('Identifica')) {
        return JSON.stringify({ claims: [{
          claim: 'La tasa de paro fue del 11,2 % en el tercer trimestre',
          articleQuote: '"La tasa de paro fue del 11,2 % en el tercer trimestre"',
          query: 'tasa de paro tercer trimestre 2026', altQuery: 'INE EPA tercer trimestre 2026 tasa de paro',
        }] });
      }
      return JSON.stringify({ status: 'supported', explanation: 'El INE y la EPA dan el 11,2 %.', evidence: [
        { sourceId: 1, quote: 'El INE confirma que la tasa de paro fue del 11,2 % en el tercer trimestre.', relation: 'supports' },
        { sourceId: 2, quote: 'la tasa de paro fue del 11,2 % en el tercer trimestre', relation: 'supports' },
        { sourceId: 3, quote: 'Cita inventada que no está en ninguna fuente real.', relation: 'contradicts' },
      ] });
    },
  };

  const { chatHistory, findings } = await factCheckArticle({
    idChat: 'fc1', installId: 'i1', locale: 'es', requestId: 't', ai, chatStore, costs,
    searchApiKey: 'k', toolsUrl: `http://127.0.0.1:${server.address().port}`,
    article: { title: 'Paro', content: 'Titular. «La tasa de paro fue del 11,2 % en el tercer trimestre», dice el artículo.', sourceUrl: 'https://origen.com/a' },
  });

  const searches = calls.filter((c) => c.path === '/search');
  assert.equal(searches.length, 2, 'una búsqueda por cada consulta');
  assert.ok(searches.every((c) => c.query.endsWith('-site:origen.com')));
  assert.ok(calls.some((c) => c.path === '/fetch' && c.url === 'https://sincontenido.com/x'), 'recupera la fuente sin contenido');

  const [finding] = findings;
  assert.equal(finding.sources[0].tier, 'official', 'la fuente oficial va primero');
  assert.equal(finding.result.status, 'supported');
  assert.equal(finding.result.evidence.length, 2, 'descarta la cita inventada');
  assert.match(prompts[1], /Tipo: fuente oficial o académica/);

  const report = chatHistory.at(-1).content;
  assert.match(report, /\*\*1\. Coincide con las fuentes: La tasa de paro/);
  assert.match(report, /^> ✓ Respalda · \[ine\.es\]/m);

  const { totals } = costs.report();
  assert.equal(totals.today.search, 2);
  assert.equal(totals.today.fetch, 1);
});
