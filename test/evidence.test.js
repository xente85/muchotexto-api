import test from 'node:test';
import assert from 'node:assert/strict';
import { containsQuote, keywords, shingles, containment } from '../src/services/evidence/text.js';
import { selectPassages } from '../src/services/evidence/passages.js';
import { selectSources, sourceTier } from '../src/services/evidence/sources.js';
import { extractClaims, validateFinding } from '../src/services/factCheck.js';

// Texto pseudoaleatorio distinto para cada semilla (palabras inventadas).
const filler = (n, seed = 'relleno') => {
  let state = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = () => { state = (state * 1103515245 + 12345) >>> 0; return state; };
  const word = () => Array.from({ length: 3 + (rand() % 6) }, () => 'abcdefghilmnoprstu'[rand() % 18]).join('');
  return Array.from({ length: n }, () => `${Array.from({ length: 14 }, word).join(' ')}.`).join('\n');
};

test('las citas toleran comillas tipográficas y espacios', () => {
  assert.ok(containsQuote('Dijo: «El paro bajó un 3,2 %» ayer.', '"El paro bajó un 3,2 %"'));
  assert.ok(containsQuote('Texto   con\nsaltos de  línea', 'texto con saltos de línea'));
  assert.ok(!containsQuote('El paro bajó un 3,2 %', 'El paro bajó un 4,2 %'));
});

test('keywords ignora tildes y palabras vacías y une números', () => {
  assert.deepEqual(keywords('El Índice subió un 3,2 % en España'), ['indice', 'subio', '32', 'espana']);
});

test('selectPassages encuentra el dato aunque esté al final', () => {
  const content = `${filler(80)}\nEl INE publicó que la tasa de paro fue del 11,2 % en el tercer trimestre de 2026.`;
  const passages = selectPassages(content, 'tasa de paro INE tercer trimestre 2026 11,2', 1500);
  assert.ok(passages.length <= 1500);
  assert.match(passages, /tasa de paro fue del 11,2 %/);
  assert.ok(content.includes(passages.split('\n…\n').at(-1)), 'los pasajes son texto literal de la fuente');
});

test('selectPassages devuelve el texto entero si cabe', () => {
  assert.equal(selectPassages('corto', 'nada', 100), 'corto');
});

test('clasifica las fuentes', () => {
  assert.equal(sourceTier('https://www.ine.es/prensa/epa.pdf'), 'official');
  assert.equal(sourceTier('https://www.sanidad.gob.es/x'), 'official');
  assert.equal(sourceTier('https://maldita.es/malditobulo/x'), 'factcheck');
  assert.equal(sourceTier('https://www.reuters.com/fact-check/x'), 'factcheck');
  assert.equal(sourceTier('https://www.reuters.com/world/x'), 'media');
  assert.equal(sourceTier('https://x.com/user/status/1'), 'ugc');
  assert.equal(sourceTier('https://es.wikipedia.org/wiki/X'), 'reference');
});

test('detecta textos copiados', () => {
  const a = shingles(filler(10, 'agencia'));
  const b = shingles(`Titular distinto. ${filler(10, 'agencia')} Firma del medio.`);
  assert.ok(containment(a, b) > 0.9);
  assert.ok(containment(a, shingles(filler(10, 'propio'))) < 0.2);
});

test('selectSources: prioriza oficiales, agrupa notas de agencia y descarta copias del artículo', () => {
  const article = filler(12, 'articulo');
  const wire = filler(12, 'agencia');
  const results = [
    { url: 'https://medio-a.com/nota', title: 'A', content: `Entradilla A. ${wire}` },
    { url: 'https://medio-b.com/nota', title: 'B', content: `Entradilla B. ${wire}` },
    { url: 'https://copia.com/x', title: 'Copia', content: article },
    { url: 'https://twitter.com/x/status/1', title: 'tw', content: filler(12, 'tuit') },
    { url: 'https://origen.com/x', title: 'Origen', content: filler(12, 'origen') },
    { url: 'https://www.ine.es/dato', title: 'INE', content: filler(12, 'ine') },
    { url: 'https://medio-a.com/otra', title: 'A2', content: filler(12, 'otra') },
  ];
  const sources = selectSources(results, { excludedDomain: 'origen.com', articleText: article, focus: 'dato' });
  const hosts = sources.map((s) => new URL(s.url).hostname);
  assert.deepEqual(hosts, ['www.ine.es', 'medio-a.com', 'medio-b.com']);
  assert.equal(sources[0].tier, 'official');
  assert.equal(sources[1].group, sources[2].group, 'misma nota de agencia, mismo grupo');
  assert.notEqual(sources[0].group, sources[1].group);
});

test('dos medios con la misma nota de agencia no bastan para concluir', () => {
  const sources = [
    { id: 1, url: 'https://medio-a.com/n', group: 1, content: 'La agencia informa de que el puente costó 12 millones de euros.' },
    { id: 2, url: 'https://medio-b.com/n', group: 1, content: 'La agencia informa de que el puente costó 12 millones de euros.' },
  ];
  const quote = 'el puente costó 12 millones de euros';
  const result = validateFinding({ status: 'supported', explanation: 'ok', evidence: [
    { sourceId: 1, quote, relation: 'supports' }, { sourceId: 2, quote, relation: 'supports' },
  ] }, sources);
  assert.equal(result.status, 'insufficient');
  const independent = validateFinding({ status: 'supported', explanation: 'ok', evidence: [
    { sourceId: 1, quote, relation: 'supports' }, { sourceId: 2, quote: 'El Ayuntamiento cifra la obra del puente en 12 millones', relation: 'supports' },
  ] }, [sources[0], { ...sources[1], group: 2, content: 'El Ayuntamiento cifra la obra del puente en 12 millones de euros.' }]);
  assert.equal(independent.status, 'supported');
});

test('extractClaims acepta comillas cambiadas y guarda altQuery', () => {
  const article = { content: 'El alcalde afirmó: «La obra costará 12 millones y acabará en 2027».' };
  const claims = extractClaims(JSON.stringify({ claims: [
    { claim: 'La obra costará 12 millones', articleQuote: '"La obra costará 12 millones y acabará en 2027"', query: 'obra 12 millones', altQuery: 'presupuesto municipal obra 2027' },
    { claim: 'Inventada', articleQuote: 'Esta frase no está en el artículo', query: 'x' },
  ] }), article);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].altQuery, 'presupuesto municipal obra 2027');
});

test('las citas toleran tildes o comas cambiadas, pero no palabras distintas', () => {
  const text = 'Su cita de 35 minutos en 2023 con el detenido Corvillo apunta al presidente.';
  assert.ok(containsQuote(text, 'Su cita de 35 minutos en 2023, con el detenido Corvillo'));
  assert.ok(containsQuote(text, 'su cita de 35 minutos en 2023 con el detenído Corvillo'));
  assert.ok(!containsQuote(text, 'Su cita de 45 minutos en 2023 con el detenido Corvillo'));
  assert.ok(!containsQuote(text, 'cita, de 35'), 'fragmentos cortos no valen en la comparación flexible');
});

test('la misma frase larga en dos webs cuenta como un solo origen', () => {
  const wire = 'Aldama declaró ante el juez sobre sus primeros contactos con Koldo y Ábalos a partir de junio de 2018';
  const sources = [
    { id: 1, url: 'https://elboletin.com/a', group: 1, content: `${wire}.` },
    { id: 2, url: 'https://otro-medio.com/b', group: 2, content: `Según la agencia, ${wire}.` },
  ];
  const result = validateFinding({ status: 'supported', explanation: 'Fuentes [1] y [2] lo confirman.', evidence: [
    { sourceId: 1, quote: wire, relation: 'supports' }, { sourceId: 2, quote: wire, relation: 'supports' },
  ] }, sources);
  assert.equal(result.status, 'insufficient');
});

test('webs hermanas y subdominios cuentan como la misma organización', async () => {
  const { ownerOf, siteOf, cleanUrl } = await import('../src/services/evidence/sources.js');
  assert.equal(siteOf('https://pre.efe.com/x'), 'efe.com');
  assert.equal(siteOf('https://www.sanidad.gob.es/x'), 'sanidad.gob.es');
  assert.equal(ownerOf('https://www.notimerica.com/x'), ownerOf('https://www.europapress.es/y'));
  assert.notEqual(ownerOf('https://elpais.com/x'), ownerOf('https://elmundo.es/y'));
  assert.equal(cleanUrl('https://a.com/n?rand=298&id=4&utm_source=x#elementor-action'), 'https://a.com/n?id=4');
});

test('la explicación nombra el medio en vez de [1]', () => {
  const sources = [
    { id: 1, url: 'https://www.ine.es/a', group: 1, content: 'El INE cifra el paro en el 11,2 % del tercer trimestre.' },
    { id: 2, url: 'https://elpais.com/b', group: 2, content: 'La EPA sitúa la tasa de desempleo en el 11,2 %.' },
  ];
  const result = validateFinding({ status: 'supported', explanation: 'Fuentes [1] y [2] dan el 11,2 %.', evidence: [
    { sourceId: 1, quote: 'El INE cifra el paro en el 11,2 % del tercer trimestre', relation: 'supports' },
    { sourceId: 2, quote: 'La EPA sitúa la tasa de desempleo en el 11,2 %', relation: 'supports' },
  ] }, sources);
  assert.equal(result.status, 'supported');
  assert.equal(result.explanation, 'ine.es y elpais.com dan el 11,2 %.');
});
