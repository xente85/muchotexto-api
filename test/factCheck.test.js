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

test('el informe breve conserva resultados y fuentes sin volcar citas', () => {
    const result = validateFinding({
        status: 'mixed', explanation: 'Dos informes dan cifras distintas.',
        evidence: [
            { sourceId: 1, quote: 'El informe oficial confirma que la cifra fue de 120 casos.', relation: 'supports' },
            { sourceId: 2, quote: 'La revisión independiente confirmó solo 90 casos en el mismo periodo.', relation: 'contradicts' },
        ],
    }, sources);
    const report = renderReport([{
        claim: { claim: 'Se registraron 120 casos.', articleQuote: 'Un largo fragmento del artículo original.' },
        result, sources,
    }], 'es');
    assert.match(report, /Las fuentes discrepan sobre una afirmación/);
    assert.match(report, /Las fuentes discrepan/);
    assert.match(report, /example\.org/);
    assert.match(report, /another\.org/);
    assert.doesNotMatch(report, /Un largo fragmento/);
    assert.doesNotMatch(report, /El informe oficial confirma/);
});
