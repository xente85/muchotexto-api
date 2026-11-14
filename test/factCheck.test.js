import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFinding, renderReport } from '../src/services/factCheck.js';

const sources = [
    { id: 1, url: 'https://example.org/one', content: 'El informe oficial confirma que la cifra fue de 120 casos.' },
    { id: 2, url: 'https://another.org/two', content: 'La revisión independiente confirmó solo 90 casos en el mismo periodo.' },
];

test('rechaza citas que no aparecen en la fuente', () => {
    const result = validateFinding({
        status: 'supported', explanation: 'Confirmado',
        evidence: [
            { sourceId: 1, quote: 'El informe oficial confirma que la cifra fue de 120 casos.', relation: 'supports' },
            { sourceId: 2, quote: 'Una frase inventada que no figura en ningún documento.', relation: 'supports' },
        ],
    }, sources);
    assert.equal(result.status, 'insufficient');
    assert.equal(result.evidence.length, 1);
});

test('exige dos dominios independientes', () => {
    const result = validateFinding({
        status: 'supported', explanation: 'Confirmado',
        evidence: [
            { sourceId: 1, quote: 'El informe oficial confirma que la cifra fue de 120 casos.', relation: 'supports' },
            { sourceId: 2, quote: 'La revisión independiente confirmó solo 90 casos en el mismo periodo.', relation: 'supports' },
        ],
    }, [sources[0], { ...sources[1], url: 'https://example.org/two' }]);
    assert.equal(result.status, 'insufficient');
});

test('conserva evidencia contradictoria en el estado mixto', () => {
    const result = validateFinding({
        status: 'supported', explanation: 'Hay discrepancias',
        evidence: [
            { sourceId: 1, quote: 'El informe oficial confirma que la cifra fue de 120 casos.', relation: 'supports' },
            { sourceId: 2, quote: 'La revisión independiente confirmó solo 90 casos en el mismo periodo.', relation: 'contradicts' },
        ],
    }, sources);
    assert.equal(result.status, 'mixed');
});

test('el informe incluye veredicto, enlaces y evidencias desplegables', () => {
    const result = validateFinding({
        status: 'mixed', explanation: 'Dos informes dan cifras distintas.',
        evidence: [
            { sourceId: 1, quote: 'El informe oficial confirma que la cifra fue de 120 casos.', relation: 'supports' },
            { sourceId: 2, quote: 'La revisión independiente confirmó solo 90 casos en el mismo periodo.', relation: 'contradicts' },
        ],
    }, sources);
    const report = renderReport([{
        claim: { claim: 'Se registraron 120 casos.', articleQuote: 'Según el artículo se registraron 120 casos.' },
        result, sources: sources.map((s, i) => ({ ...s, tier: i === 0 ? 'official' : 'media', date: '2026-11-02T10:00:00Z' })),
    }], 'es');
    assert.match(report, /^\*\*Las fuentes discrepan sobre una afirmación\.\*\*/);
    assert.match(report, /\*\*1\. Las fuentes discrepan: Se registraron 120 casos\.\*\*/);
    assert.match(report, /Fuentes: \[example\.org\]\(https:\/\/example\.org\/one\) · \[another\.org\]/);
    assert.match(report, /^> En el artículo: «Según el artículo se registraron 120 casos\.»$/m);
    assert.match(report, /^> ✓ Respalda · \[example\.org\]\(https:\/\/example\.org\/one\) \(fuente oficial, 2026-11-02\): «El informe oficial/m);
    assert.match(report, /^> ✗ Contradice · \[another\.org\]/m);
});

test('el informe en inglés', () => {
    const report = renderReport([{ claim: { claim: 'X', articleQuote: 'Una cita del artículo suficientemente larga.' },
        result: { status: 'insufficient', explanation: 'n/a', evidence: [] }, sources: [] }], 'en-US');
    assert.match(report, /\*\*1\. Not verified: X\*\*/);
    assert.doesNotMatch(report, /^> /m, 'sin evidencias no hay bloque desplegable');
});
