/**
 * Normaliza texto para comparar citas: minúsculas, espacios simples y
 * comillas, guiones y puntos suspensivos tipográficos convertidos a ASCII.
 * Los modelos suelen cambiar «» por "" al copiar, y eso no debe invalidar una cita.
 */
export function normalizeForMatch(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟«»″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Solo letras y números, sin tildes: para la comparación de respaldo. */
export function looseForm(value) {
  return normalizeForMatch(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ').trim();
}

/**
 * true si `quote` aparece en `haystack`. Primero compara el texto normalizado;
 * si no coincide, repite ignorando tildes y signos de puntuación (la IA a veces
 * cambia una coma o un acento al copiar), pero exige el mismo orden de palabras.
 */
export function containsQuote(haystack, quote) {
  const q = normalizeForMatch(quote).replace(/^["'(]+|["').,;:]+$/g, '');
  if (!q) return false;
  if (normalizeForMatch(haystack).includes(q)) return true;
  const loose = looseForm(q);
  return loose.length >= 15 && ` ${looseForm(haystack)} `.includes(` ${loose} `);
}

const STOPWORDS = new Set(`de la que el en y a los del se las por un para con no una su al lo como mas más pero sus le ya o
este esta sí si porque muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso
ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar
estas algunas algo nosotros mi mis tú te ti tu tus ellas ser es son era fue han ha sido según dijo cuando año años
the of and to in a is that for on was with as by at it from be this are or an have has had not but which were their its
they been will would there what said about more than into after over also can who when said says`.split(/\s+/));

/** Palabras significativas sin tildes; los números pesan más al puntuar. */
export function keywords(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d)[.,](\d)/g, '$1$2')
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w && !STOPWORDS.has(w) && (w.length >= 3 || /\d/.test(w)));
}

/** Conjunto de secuencias de `k` palabras, para detectar textos copiados. */
export function shingles(text, k = 8) {
  const words = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ñ]+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i + k <= words.length; i += 1) set.add(words.slice(i, i + k).join(' '));
  return set;
}

/** Proporción de `part` que aparece también en `whole` (0–1). */
export function coverage(part, whole) {
  if (!part.size) return 0;
  let shared = 0;
  for (const item of part) if (whole.has(item)) shared += 1;
  return shared / part.size;
}

/** Proporción del texto más corto que aparece también en el otro (0–1). */
export function containment(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const item of small) if (big.has(item)) shared += 1;
  return shared / small.size;
}

/**
 * true si dos citas parecen el mismo texto copiado (mismo teletipo con
 * retoques mínimos). Frases cortas iguales no cuentan: dos medios pueden
 * redactar igual un dato ("la tasa de paro fue del 11,2 %").
 */
export function sameQuote(a, b) {
  const x = looseForm(a).split(' ').filter(Boolean);
  const y = looseForm(b).split(' ').filter(Boolean);
  const shorter = Math.min(x.length, y.length);
  if (x.join(' ') === y.join(' ')) return shorter >= 8;
  if (shorter < 15) return false;
  const wa = new Set(x);
  const wb = new Set(y);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size) >= 0.9;
}
