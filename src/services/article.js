import axios from 'axios';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { HttpError } from '../lib/httpError.js';
import { LruCache } from '../lib/lruCache.js';
import { parseHttpUrl, pointsToPrivateNetwork } from '../lib/safeUrl.js';

const MAX_REDIRECTS = 5;
// Códigos que hacen que la extensión lea el artículo desde una pestaña del navegador.
const BROWSER_FALLBACK = 'ARTICLE_PROTECTED';
const BROWSER_REQUIRED = 'ARTICLE_BROWSER_REQUIRED';

function isAntiBot(response) {
  if (!response || response.status !== 403) return false;
  const headers = response.headers || {};
  return headers['x-datadome'] === 'protected' || Boolean(headers['x-dd-b']) ||
    String(response.data || '').includes('captcha-delivery.com');
}

/** Texto plano con párrafos, sin espacios repetidos. Menos tokens que el HTML. */
export function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractArticle(html, url) {
  // Silencia los avisos de CSS/JS de jsdom, que no aportan nada aquí.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const { document } = dom.window;
  const publishedAt =
    document.querySelector('meta[property="article:published_time"]')?.content ||
    document.querySelector('meta[name="date"]')?.content ||
    document.querySelector('time[datetime]')?.getAttribute('datetime') ||
    '';

  const parsed = new Readability(document).parse();
  dom.window.close();
  if (!parsed?.textContent?.trim()) return null;

  const content = normalizeText(parsed.textContent);
  return {
    title: parsed.title || '',
    byline: parsed.byline || '',
    siteName: parsed.siteName || '',
    excerpt: parsed.excerpt || '',
    content,
    textContent: content,
    length: content.length,
    publishedAt,
  };
}

/** Descarga y extrae artículos, con caché acotada y protección frente a URLs internas. */
export function createArticleService(config, { http = axios, resolveHost } = {}) {
  const cache = new LruCache({ maxSize: config.cacheSize, ttlMs: config.cacheTtlMs });

  async function assertPublic(url) {
    if (config.allowPrivateNetwork) return;
    let isPrivate;
    try {
      isPrivate = await pointsToPrivateNetwork(url, resolveHost);
    } catch {
      throw new HttpError(502, 'ARTICLE_REQUEST_FAILED', 'No se pudo resolver la dirección del enlace.');
    }
    if (isPrivate) {
      // La extensión lo leerá desde el navegador, que sí tiene acceso a la red local.
      throw new HttpError(422, BROWSER_REQUIRED, 'Esta dirección es de una red local; se leerá desde el navegador.');
    }
  }

  async function download(startUrl) {
    let url = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublic(url);
      let response;
      try {
        response = await http.get(url.href, {
          headers: {
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (compatible; MuchoTexto/1.0)',
          },
          timeout: config.timeoutMs,
          responseType: 'text',
          maxContentLength: config.maxBytes,
          maxRedirects: 0,
          validateStatus: () => true,
        });
      } catch (error) {
        console.error('[article] download.failed', { code: error?.code });
        throw new HttpError(502, 'ARTICLE_REQUEST_FAILED', 'No se pudo descargar el artículo.');
      }

      if (response.status >= 300 && response.status < 400 && response.headers?.location) {
        const next = parseHttpUrl(new URL(response.headers.location, url).href);
        if (!next) break;
        url = next;
        continue;
      }
      if (response.status === 406) {
        throw new HttpError(422, BROWSER_FALLBACK, 'La web ha rechazado la descarga del artículo (406). Se leerá desde el navegador.');
      }
      if (isAntiBot(response)) {
        throw new HttpError(422, BROWSER_FALLBACK, 'La web ha bloqueado la lectura automática con una protección anti-bot/captcha.');
      }
      if (response.status >= 400) {
        console.error('[article] download.failed', { status: response.status });
        // Muchas webs devuelven 401/403 a peticiones que no vienen de un navegador.
        const code = [401, 403, 429].includes(response.status) ? BROWSER_FALLBACK : 'ARTICLE_REQUEST_FAILED';
        throw new HttpError(code === BROWSER_FALLBACK ? 422 : 502, code, `No se pudo descargar el artículo (${response.status}).`);
      }
      return { html: response.data, finalUrl: url };
    }
    throw new HttpError(502, 'ARTICLE_REQUEST_FAILED', 'El enlace tiene demasiadas redirecciones.');
  }

  return {
    async get(link) {
      const url = parseHttpUrl(link);
      if (!url) throw new HttpError(400, 'INVALID_LINK', 'El enlace debe ser una URL http o https válida.');

      const cached = cache.get(url.href);
      if (cached) return cached;

      const { html, finalUrl } = await download(url);
      const article = extractArticle(html, finalUrl.href);
      if (!article) {
        throw new HttpError(422, BROWSER_REQUIRED, 'No se pudo extraer el texto del artículo; se leerá desde el navegador.');
      }
      cache.set(url.href, article);
      return article;
    },
  };
}
