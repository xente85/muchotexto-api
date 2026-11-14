import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, pointsToPrivateNetwork } from '../src/lib/safeUrl.js';
import { LruCache } from '../src/lib/lruCache.js';
import { trimHistory } from '../src/services/conversation.js';
import { createArticleService, normalizeText } from '../src/services/article.js';

test('detecta direcciones privadas', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '151.101.1.1', '2a00:1450:4003::1']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('resuelve el host antes de decidir', async () => {
  const resolve = async () => [{ address: '10.0.0.5' }];
  assert.equal(await pointsToPrivateNetwork(new URL('https://interno.example'), resolve), true);
  assert.equal(await pointsToPrivateNetwork(new URL('http://localhost:8080')), true);
});

test('LRU respeta tamaño y caducidad', () => {
  const cache = new LruCache({ maxSize: 2, ttlMs: 1000 });
  cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  const expired = new LruCache({ maxSize: 2, ttlMs: -1 });
  expired.set('x', 1);
  assert.equal(expired.get('x'), undefined);
});

test('trimHistory conserva el primer mensaje y los últimos', () => {
  const msgs = Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: String(i) }));
  assert.deepEqual(trimHistory(msgs, 3).map((m) => m.content), ['0', '7', '8', '9']);
  assert.equal(trimHistory(msgs.slice(0, 3), 3).length, 3);
});

test('normalizeText compacta espacios y conserva párrafos', () => {
  assert.equal(normalizeText('  Hola   mundo \n\n\n\n Adiós\t '), 'Hola mundo\n\nAdiós');
});

const publicDns = async () => [{ address: '93.184.216.34' }];
const html = `<html><head><title>Titular</title><meta property="article:published_time" content="2026-01-02"></head>
<body><article><h1>Titular</h1>${'<p>Este es un párrafo largo del artículo con suficiente texto para Readability. </p>'.repeat(20)}</article></body></html>`;

test('extrae el artículo en texto plano y lo cachea', async () => {
  let calls = 0;
  const http = { get: async () => { calls += 1; return { status: 200, headers: {}, data: html }; } };
  const svc = createArticleService({ timeoutMs: 1000, maxBytes: 1e6, cacheSize: 10, cacheTtlMs: 60_000, allowPrivateNetwork: false }, { http, resolveHost: publicDns });
  const article = await svc.get('https://news.example/a');
  assert.equal(article.publishedAt, '2026-01-02');
  assert.match(article.content, /párrafo largo/);
  assert.doesNotMatch(article.content, /<p>/);
  await svc.get('https://news.example/a');
  assert.equal(calls, 1);
});

test('bloquea redirecciones hacia la red local', async () => {
  const http = { get: async () => ({ status: 302, headers: { location: 'http://127.0.0.1/admin' }, data: '' }) };
  const svc = createArticleService({ timeoutMs: 1000, maxBytes: 1e6, cacheSize: 10, cacheTtlMs: 60_000, allowPrivateNetwork: false }, { http, resolveHost: publicDns });
  await assert.rejects(svc.get('https://news.example/r'), (e) => e.code === 'ARTICLE_BROWSER_REQUIRED');
});

test('anti-bot pide leer desde el navegador', async () => {
  const http = { get: async () => ({ status: 403, headers: { 'x-datadome': 'protected' }, data: '' }) };
  const svc = createArticleService({ timeoutMs: 1000, maxBytes: 1e6, cacheSize: 10, cacheTtlMs: 60_000, allowPrivateNetwork: false }, { http, resolveHost: publicDns });
  await assert.rejects(svc.get('https://news.example/p'), (e) => e.code === 'ARTICLE_PROTECTED' && e.status === 422);
});

test('rechaza enlaces no http', async () => {
  const svc = createArticleService({ cacheSize: 1, cacheTtlMs: 1 }, {});
  await assert.rejects(svc.get('file:///etc/passwd'), (e) => e.code === 'INVALID_LINK');
});

import { decodeHtml } from '../src/lib/decodeHtml.js';

const latin1 = (text) => Buffer.from([...text].map((c) => c.charCodeAt(0)));

test('decodeHtml respeta la codificación de la cabecera', () => {
  assert.equal(decodeHtml(latin1('<p>Sánchez favoreció</p>'), 'text/html; charset=ISO-8859-15'), '<p>Sánchez favoreció</p>');
});

test('decodeHtml lee <meta charset> si la cabecera no lo dice', () => {
  const html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"></head><body>reactivación</body></html>';
  assert.match(decodeHtml(latin1(html), 'text/html'), /reactivación/);
});

test('decodeHtml usa UTF-8 y, si los bytes no lo son, Windows-1252', () => {
  assert.equal(decodeHtml(Buffer.from('<p>ñandú</p>', 'utf8'), 'text/html'), '<p>ñandú</p>');
  assert.equal(decodeHtml(latin1('<p>año</p>'), ''), '<p>año</p>');
});

test('una web en ISO-8859-15 se extrae con tildes', async () => {
  const html = `<html><head><meta charset="iso-8859-15"><title>Sánchez y la reactivación</title></head><body><article><h1>Sánchez</h1>${'<p>El presidente favoreció la reactivación según los investigadores de la Guardia Civil. </p>'.repeat(20)}</article></body></html>`;
  const http = { get: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, data: latin1(html) }) };
  const svc = createArticleService({ timeoutMs: 1000, maxBytes: 1e6, cacheSize: 10, cacheTtlMs: 60_000, allowPrivateNetwork: false }, { http, resolveHost: publicDns });
  const article = await svc.get('https://news.example/latin');
  assert.match(article.title, /Sánchez y la reactivación/);
  assert.match(article.content, /favoreció la reactivación/);
});
