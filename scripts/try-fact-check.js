#!/usr/bin/env node
/**
 * Prueba el análisis de evidencias con un artículo real y muestra el detalle:
 * afirmaciones, fuentes elegidas, veredictos, informe final y coste.
 *
 *   npm run try:fact-check -- https://ejemplo.com/noticia
 *   docker compose exec api node scripts/try-fact-check.js https://ejemplo.com/noticia
 *
 * Usa las claves de .env y hace llamadas reales (unos céntimos por artículo).
 * No guarda nada en la base de datos.
 */
import { loadConfig } from '../src/config.js';
import { createAiClient } from '../src/services/ai.js';
import { createArticleService } from '../src/services/article.js';
import { factCheckArticle } from '../src/services/factCheck.js';
import { costOf } from '../src/services/costTracker.js';

const url = process.argv[2];
const locale = process.argv[3] || 'es';
if (!url) {
  console.error('Uso: npm run try:fact-check -- <url> [locale]');
  process.exit(1);
}

const config = loadConfig();
const totals = { input: 0, cached: 0, output: 0, search: 0, fetch: 0 };
const record = ({ tokens = {}, search = 0, fetch = 0 }) => {
  totals.input += tokens.input || 0;
  totals.cached += tokens.cached || 0;
  totals.output += tokens.output || 0;
  totals.search += search;
  totals.fetch += fetch;
};
const ai = createAiClient(config.ai, { onUsage: record });

// Historial en memoria: el script no toca la base de datos.
const messages = [];
const chatStore = { addMessage: (_id, _install, message) => { messages.push(message); return [...messages]; } };

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const started = Date.now();
console.log(dim(`Leyendo ${url}…`));
const article = await createArticleService({ ...config.article, allowPrivateNetwork: true }).get(url);
console.log(`${bold(article.title)}  ${dim(`(${article.content.length} caracteres, ${article.publishedAt || 'sin fecha'})`)}\n`);

const { findings, chatHistory } = await factCheckArticle({
  idChat: 'try', installId: 'try', locale, requestId: 'try',
  article: { ...article, sourceUrl: url },
  ai, chatStore, costs: { record }, searchApiKey: config.ai.keys.deepseek, toolsUrl: config.ai.toolsUrl,
});

findings.forEach(({ claim, sources, result }, i) => {
  console.log(bold(`${i + 1}. ${claim.claim}`));
  console.log(dim(`   búsquedas: «${claim.query}» | «${claim.altQuery || '-'}»`));
  for (const s of sources) {
    const used = result.evidence.filter((e) => e.sourceId === s.id).map((e) => e.relation).join(',');
    console.log(`   [${s.id}] ${s.tier.padEnd(9)} grupo ${s.group}  ${s.url}${used ? `  ← ${used}` : ''}`);
  }
  console.log(`   → ${bold(result.status)}: ${result.explanation}\n`);
});

console.log(bold('Informe que vería el usuario:\n'));
console.log(chatHistory.at(-1).content);

const cost = costOf(totals, config.pricing);
console.log(dim(`\n${((Date.now() - started) / 1000).toFixed(1)} s · ${totals.input} tokens entrada (${totals.cached} en caché) · ${totals.output} salida · ${totals.search} búsquedas · ${totals.fetch} lecturas · ≈ $${cost.toFixed(4)}`));
