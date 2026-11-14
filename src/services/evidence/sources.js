import { containment, coverage, shingles } from './text.js';

// Textos con menos secuencias que esto son demasiado cortos para compararlos.
const MIN_SHINGLES = 20;
import { selectPassages } from './passages.js';

export const MAX_SOURCES = 5;
const PASSAGE_CHARS = 3500;

// Verificadores profesionales (firmantes de IFCN o equivalentes). Admite rutas: "reuters.com/fact-check".
const FACT_CHECKERS = [
  'maldita.es', 'newtral.es', 'verifica.efe.com', 'efe.com/efe-verifica', 'factual.afp.com', 'factcheck.afp.com',
  'fullfact.org', 'factcheck.org', 'politifact.com', 'snopes.com', 'chequeado.com', 'colombiacheck.com',
  'correctiv.org', 'pagellapolitica.it', 'leadstories.com', 'reuters.com/fact-check', 'apnews.com/ap-fact-check',
  'healthfeedback.org', 'climatefeedback.org', 'verificat.cat', 'demagog.org.pl',
];

const OFFICIAL_HOSTS = [
  'boe.es', 'ine.es', 'bde.es', 'cis.es', 'aemet.es', 'congreso.es', 'senado.es', 'poderjudicial.es',
  'who.int', 'un.org', 'oecd.org', 'imf.org', 'worldbank.org', 'europa.eu', 'nih.gov', 'cdc.gov',
];
const OFFICIAL_SUFFIX = /\.(gob|gov|gouv|gv|go)(\.[a-z]{2})?$|\.int$|\.edu$|\.edu\.[a-z]{2}$|\.europa\.eu$/;

// Redes sociales y contenido de usuarios: no sirven como evidencia.
const USER_CONTENT = [
  'facebook.com', 'x.com', 'twitter.com', 'tiktok.com', 'instagram.com', 'youtube.com', 'reddit.com',
  'pinterest.com', 'quora.com', 'medium.com', 'threads.net', 't.me', 'linkedin.com',
];
const REFERENCE = ['wikipedia.org', 'wikiwand.com', 'britannica.com'];

const TIER_ORDER = { factcheck: 0, official: 1, media: 2, reference: 3 };

export function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function matchesHost(host, entry) {
  return host === entry || host.endsWith(`.${entry}`);
}

function matchesEntry(url, host, entry) {
  const [entryHost, ...path] = entry.split('/');
  if (!matchesHost(host, entryHost)) return false;
  if (!path.length) return true;
  try { return new URL(url).pathname.startsWith(`/${path.join('/')}`); } catch { return false; }
}

/** Tipo de fuente: factcheck, official, media, reference o ugc (descartada). */
export function sourceTier(url) {
  const host = domain(url);
  if (!host) return 'ugc';
  if (FACT_CHECKERS.some((entry) => matchesEntry(url, host, entry))) return 'factcheck';
  if (USER_CONTENT.some((entry) => matchesHost(host, entry))) return 'ugc';
  if (OFFICIAL_HOSTS.some((entry) => matchesHost(host, entry)) || OFFICIAL_SUFFIX.test(host)) return 'official';
  if (REFERENCE.some((entry) => matchesHost(host, entry))) return 'reference';
  return 'media';
}

function validUrl(url) {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
  } catch { return ''; }
}

/**
 * Elige hasta MAX_SOURCES fuentes para una afirmación:
 * - descarta el propio medio, redes sociales y páginas que copian el artículo;
 * - agrupa las que publican el mismo texto (notas de agencia) para no contarlas
 *   como fuentes independientes;
 * - prioriza verificadores y fuentes oficiales, y luego el orden del buscador;
 * - de cada fuente se queda con los pasajes relacionados con la afirmación.
 */
export function selectSources(results, { excludedDomain = '', articleText = '', focus = '' } = {}) {
  const articleShingles = shingles(articleText);
  const seenUrls = new Set();
  const seenDomains = new Set();
  const candidates = [];

  results.forEach((item, rank) => {
    const url = validUrl(item?.url);
    const host = domain(url);
    const content = String(item?.content || '').trim();
    if (!url || !host || !content || content.length < 200) return;
    if (host === excludedDomain || seenUrls.has(url) || seenDomains.has(host)) return;
    const tier = sourceTier(url);
    if (tier === 'ugc') return;
    const fingerprint = shingles(content);
    // Una página que reproduce el artículo no puede confirmarlo. Se mide qué parte
    // de la fuente está en el artículo: citar una frase del artículo no la descarta.
    if (fingerprint.size >= MIN_SHINGLES && coverage(fingerprint, articleShingles) > 0.5) return;
    seenUrls.add(url);
    seenDomains.add(host);
    candidates.push({ url, host, tier, rank, item, content, fingerprint });
  });

  candidates.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.rank - b.rank);

  // Grupos de contenido casi idéntico (misma nota de agencia en varios medios).
  const groups = [];
  for (const candidate of candidates) {
    const comparable = candidate.fingerprint.size >= MIN_SHINGLES;
    const group = comparable && groups.find((g) => g.fingerprint.size >= MIN_SHINGLES &&
      containment(g.fingerprint, candidate.fingerprint) > 0.5);
    if (group) {
      candidate.group = group.id;
    } else {
      candidate.group = groups.length + 1;
      groups.push({ id: candidate.group, fingerprint: candidate.fingerprint });
    }
  }

  // Primero una fuente por grupo; las copias solo si sobra sitio.
  const seenGroups = new Set();
  const primary = [];
  const copies = [];
  for (const candidate of candidates) {
    if (seenGroups.has(candidate.group)) {
      copies.push(candidate);
    } else {
      seenGroups.add(candidate.group);
      primary.push(candidate);
    }
  }

  return [...primary, ...copies].slice(0, MAX_SOURCES).map((c, index) => ({
    id: index + 1,
    url: c.url,
    title: String(c.item.title || c.host).replace(/\s+/g, ' ').slice(0, 150),
    date: String(c.item.date || c.item.published_date || '').slice(0, 40),
    tier: c.tier,
    group: c.group,
    content: selectPassages(c.content, focus, PASSAGE_CHARS),
  }));
}
