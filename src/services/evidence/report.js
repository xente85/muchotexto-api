import { domain } from './sources.js';

const isEnglish = (locale) => String(locale || '').toLowerCase().startsWith('en');

const TEXT = {
  es: {
    labels: { supported: 'Coincide con las fuentes', partial: 'Coincide en lo esencial', contradicted: 'No coincide', mixed: 'Las fuentes discrepan', insufficient: 'No comprobado' },
    relation: { supports: '✓ Respalda', contradicts: '✗ Contradice' },
    tier: { factcheck: 'verificador', official: 'fuente oficial', reference: 'referencia', media: '' },
    article: 'En el artículo',
    sources: 'Fuentes',
    contradicted: 'Al menos una afirmación no coincide con las fuentes.',
    mixed: 'Las fuentes discrepan sobre una afirmación.',
    insufficient: 'Faltan datos para comprobar todas las afirmaciones.',
    partial: 'Las afirmaciones revisadas coinciden con las fuentes en lo esencial, con algún matiz.',
    supported: 'Las afirmaciones revisadas coinciden con las fuentes encontradas.',
    footer: 'Análisis automático de algunas afirmaciones, no una calificación de todo el artículo. Revisa las fuentes antes de sacar conclusiones.',
  },
  en: {
    labels: { supported: 'Matches the sources', partial: 'Mostly accurate', contradicted: 'Does not match', mixed: 'Sources disagree', insufficient: 'Not verified' },
    relation: { supports: '✓ Supports', contradicts: '✗ Contradicts' },
    tier: { factcheck: 'fact-checker', official: 'official source', reference: 'reference', media: '' },
    article: 'In the article',
    sources: 'Sources',
    contradicted: 'At least one claim does not match the sources.',
    mixed: 'The sources disagree on at least one claim.',
    insufficient: 'There is not enough evidence to check every claim.',
    partial: 'The reviewed claims are mostly accurate, with some nuances.',
    supported: 'The reviewed claims match the sources found.',
    footer: 'Automated review of selected claims, not a rating of the whole article. Check the sources before drawing conclusions.',
  },
};

const shorten = (text, max) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

function formatDate(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

/** Evidencias que se muestran: una por origen y, en "mixed", primero una de cada lado. */
function shownEvidence(result) {
  const seen = new Set();
  const relevant = result.evidence.filter((item) => {
    if (item.relation === 'context') return false;
    const key = `${item.origin || item.sourceId}:${item.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (result.status !== 'mixed') return relevant.slice(0, 3);
  const first = [relevant.find((i) => i.relation === 'supports'), relevant.find((i) => i.relation === 'contradicts')].filter(Boolean);
  return [...first, ...relevant.filter((i) => !first.includes(i))].slice(0, 3);
}

/**
 * Informe en el Markdown sencillo que entiende la ventana de la extensión:
 * **negrita**, [enlaces](url) y líneas "> " que se muestran como un bloque
 * desplegable de evidencias.
 */
export function renderReport(findings, locale) {
  const t = TEXT[isEnglish(locale) ? 'en' : 'es'];
  const has = (status) => findings.some((f) => f.result.status === status);
  const takeaway = has('contradicted') ? t.contradicted : has('mixed') ? t.mixed
    : has('insufficient') ? t.insufficient : has('partial') ? t.partial : t.supported;

  const blocks = findings.map(({ claim, result, sources }, index) => {
    const lines = [`**${index + 1}. ${t.labels[result.status]}: ${claim.claim}**`, result.explanation];
    const evidence = shownEvidence(result);
    const cited = [...new Set(evidence.map((e) => e.sourceId))].map((id) => sources.find((s) => s.id === id)).filter(Boolean);
    if (cited.length) {
      lines.push(`${t.sources}: ${cited.slice(0, 3).map((s) => `[${domain(s.url)}](${s.url})`).join(' · ')}`);
    }

    const details = [`> ${t.article}: «${shorten(claim.articleQuote, 220)}»`];
    for (const item of evidence) {
      const source = sources.find((s) => s.id === item.sourceId);
      if (!source) continue;
      const meta = [t.tier[source.tier], formatDate(source.date)].filter(Boolean).join(', ');
      details.push(`> ${t.relation[item.relation]} · [${domain(source.url)}](${source.url})${meta ? ` (${meta})` : ''}: «${shorten(item.quote, 240)}»`);
    }
    if (details.length > 1) lines.push(...details);
    return lines.join('\n');
  });

  return [`**${takeaway}**`, ...blocks, t.footer].join('\n\n');
}
