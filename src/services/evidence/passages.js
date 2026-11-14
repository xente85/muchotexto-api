import { keywords } from './text.js';

const MAX_CHUNK = 700;

function chunk(content) {
  const paragraphs = String(content || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHUNK) {
      chunks.push(paragraph);
      continue;
    }
    // Párrafos largos: por frases, agrupadas hasta MAX_CHUNK.
    let current = '';
    for (const sentence of paragraph.match(/[^.!?]+[.!?]+["»”)]*\s*|[^.!?]+$/g) || [paragraph]) {
      if (current && current.length + sentence.length > MAX_CHUNK) {
        chunks.push(current.trim());
        current = '';
      }
      current += sentence;
    }
    if (current.trim()) chunks.push(current.trim());
  }
  return chunks;
}

/**
 * Devuelve los fragmentos de `content` más relacionados con `query`, en su
 * orden original y sin pasar de `maxChars`. Cada fragmento es texto literal
 * de la fuente, así que las citas que la IA copie de ellos siguen siendo
 * comprobables. Si nada coincide, devuelve el principio del texto.
 */
export function selectPassages(content, query, maxChars = 3500) {
  const text = String(content || '').trim();
  if (text.length <= maxChars) return text;

  const terms = new Map();
  for (const word of keywords(query)) terms.set(word, /\d/.test(word) ? 3 : 1);
  const chunks = chunk(text);

  const scored = chunks.map((piece, index) => {
    const words = new Set(keywords(piece));
    let score = 0;
    for (const [term, weight] of terms) if (words.has(term)) score += weight;
    return { piece, index, score };
  });

  const picked = [];
  let used = 0;
  for (const item of [...scored].filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)) {
    const cost = item.piece.length + 3;
    if (used + cost > maxChars) continue;
    picked.push(item);
    used += cost;
  }
  if (!picked.length) return text.slice(0, maxChars);

  // Rellena con los primeros fragmentos (contexto: titular, entradilla) si sobra sitio.
  for (const item of scored) {
    if (picked.includes(item)) continue;
    const cost = item.piece.length + 3;
    if (used + cost > maxChars) break;
    picked.push(item);
    used += cost;
  }

  return picked.sort((a, b) => a.index - b.index).map((item) => item.piece).join('\n…\n');
}
