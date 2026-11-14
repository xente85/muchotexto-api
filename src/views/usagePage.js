const escape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const usd = (value) => {
  const n = Number(value) || 0;
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
};
const int = (value) => (Number(value) || 0).toLocaleString('es-ES');
const KIND = { prompt: 'Resúmenes, traducciones y respuestas', factCheck: 'Análisis de evidencias' };

function card(title, totals, budget) {
  const pct = budget > 0 ? Math.min(100, (totals.cost / budget) * 100) : null;
  return `<section class="card">
    <h2>${title}</h2>
    <p class="big">${usd(totals.cost)}</p>
    ${pct === null ? '<p class="muted">Sin límite de gasto</p>' : `
      <div class="bar"><span style="width:${pct.toFixed(1)}%" class="${pct >= 90 ? 'warn' : ''}"></span></div>
      <p class="muted">${pct.toFixed(0)} % de ${usd(budget)}</p>`}
    <dl>
      <dt>Llamadas a la IA</dt><dd>${int(totals.calls - totals.cacheHits - totals.search - totals.fetch)}</dd>
      <dt>Respuestas reutilizadas</dt><dd>${int(totals.cacheHits)}</dd>
      <dt>Tokens de entrada</dt><dd>${int(totals.input)} <small>(${int(totals.cached)} en caché)</small></dd>
      <dt>Tokens de salida</dt><dd>${int(totals.output)}</dd>
      <dt>Búsquedas / lecturas web</dt><dd>${int(totals.search)} / ${int(totals.fetch)}</dd>
    </dl>
  </section>`;
}

function table(headers, rows) {
  if (!rows.length) return '<p class="muted">Todavía no hay datos.</p>';
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function renderUsagePage(report, { jsonHref = '/admin/usage.json' } = {}) {
  const { totals, budget, pricing } = report;
  const tokensCell = (r) => `${int(r.input)} / ${int(r.output)}`;
  const unpriced = pricing.input === 0 && pricing.output === 0;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MuchoTexto · Consumo</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f6f4; --fg:#161616; --muted:#6b6b6b; --card:#fff; --line:#e3e3e0; --accent:#2f6fde; --warn:#d0451b; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141414; --fg:#ececec; --muted:#9a9a9a; --card:#1e1e1e; --line:#2e2e2e; } }
  body { margin:0; font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width:1000px; margin:0 auto; padding:32px 20px 60px; }
  h1 { margin:0 0 4px; font-size:24px; } h2 { margin:0 0 8px; font-size:15px; color:var(--muted); font-weight:600; }
  h3 { margin:36px 0 10px; font-size:17px; }
  .muted { color:var(--muted); margin:4px 0; } small { color:var(--muted); }
  .cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(270px, 1fr)); gap:16px; margin-top:24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px; }
  .big { font-size:30px; font-weight:700; margin:0; font-variant-numeric:tabular-nums; }
  .bar { height:6px; background:var(--line); border-radius:3px; overflow:hidden; margin-top:10px; }
  .bar span { display:block; height:100%; background:var(--accent); } .bar span.warn { background:var(--warn); }
  dl { display:grid; grid-template-columns:1fr auto; gap:4px 12px; margin:14px 0 0; font-size:13px; }
  dt { color:var(--muted); } dd { margin:0; text-align:right; font-variant-numeric:tabular-nums; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; font-size:13px; }
  th, td { padding:8px 12px; text-align:right; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
  th:first-child, td:first-child { text-align:left; } th { color:var(--muted); font-weight:600; }
  tr:last-child td { border-bottom:none; }
  .note { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--warn); padding:10px 14px; border-radius:6px; margin-top:16px; }
  code { font-size:12px; }
</style></head>
<body><main>
  <h1>Consumo de la IA</h1>
  <p class="muted">Hoy es ${escape(report.today)} (${escape(report.timeZone)}). El coste es una estimación con los precios configurados; la factura del proveedor es la referencia.</p>
  ${unpriced ? '<p class="note">No hay precios configurados para este modelo: define <code>AI_PRICE_INPUT</code>, <code>AI_PRICE_CACHED_INPUT</code> y <code>AI_PRICE_OUTPUT</code> en <code>.env</code>.</p>' : ''}

  <div class="cards">
    ${card('Hoy', totals.today, budget.dailyUsd)}
    ${card('Este mes', totals.month, budget.monthlyUsd)}
    ${card('Total', totals.all, 0)}
  </div>

  <h3>Últimos 30 días</h3>
  ${table(['Día', 'Llamadas', 'Tokens entrada / salida', 'Búsquedas', 'Coste'],
    report.byDay.map((r) => [escape(r.day), int(r.calls), tokensCell(r), int(r.search + r.fetch), usd(r.cost)]))}

  <h3>Este mes por tipo</h3>
  ${table(['Tipo', 'Llamadas', 'Tokens entrada / salida', 'Coste'],
    report.byKind.map((r) => [escape(KIND[r.kind] || r.kind), int(r.calls), tokensCell(r), usd(r.cost)]))}

  <h3>Este mes por modelo</h3>
  ${table(['Proveedor / modelo', 'Llamadas', 'Tokens entrada / salida', 'Coste'],
    report.byModel.map((r) => [`${escape(r.provider)} / ${escape(r.model)}`, int(r.calls), tokensCell(r), usd(r.cost)]))}

  <h3>Instalaciones que más gastan este mes</h3>
  ${table(['Instalación', 'Llamadas', 'Coste'],
    report.byInstall.map((r) => [`<code>${escape(String(r.installId).slice(0, 8))}…</code>`, int(r.calls), usd(r.cost)]))}

  <h3>Configuración</h3>
  ${table(['Concepto', 'Valor'], [
    ['Entrada (USD / millón de tokens)', usd(pricing.input)],
    ['Entrada en caché (USD / millón)', usd(pricing.cachedInput)],
    ['Salida (USD / millón de tokens)', usd(pricing.output)],
    ['Búsqueda / lectura web (USD por petición)', `${usd(pricing.searchCall)} / ${usd(pricing.fetchCall)}`],
    ['Límite diario (AI_DAILY_BUDGET_USD)', budget.dailyUsd ? usd(budget.dailyUsd) : 'sin límite'],
    ['Límite mensual (AI_MONTHLY_BUDGET_USD)', budget.monthlyUsd ? usd(budget.monthlyUsd) : 'sin límite'],
  ])}
  <p class="muted">Para cambiar precios o límites edita <code>.env</code> y vuelve a lanzar <code>npm run docker:up</code>. Datos en JSON: <a href="${escape(jsonHref)}">usage.json</a>.</p>
</main></body></html>`;
}
