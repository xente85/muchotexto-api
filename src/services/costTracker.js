import { HttpError } from '../lib/httpError.js';

/** Fecha YYYY-MM-DD en la zona horaria indicada. */
export function dayKey(timestamp, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(timestamp));
}

/**
 * Tokens de una respuesta chat-completions. Cada proveedor indica los tokens
 * de entrada servidos desde su caché con un campo distinto.
 */
export function readUsage(usage) {
  const input = Number(usage?.prompt_tokens) || 0;
  const cached = Number(
    usage?.prompt_cache_hit_tokens ?? // DeepSeek
    usage?.prompt_tokens_details?.cached_tokens ?? // OpenAI
    usage?.cached_tokens ?? // Kimi
    0
  ) || 0;
  return { input, cached: Math.min(cached, input), output: Number(usage?.completion_tokens) || 0 };
}

export function costOf({ input = 0, cached = 0, output = 0, search = 0, fetch = 0 }, pricing) {
  const perToken = ((input - cached) * pricing.input + cached * pricing.cachedInput + output * pricing.output) / 1e6;
  return perToken + search * pricing.searchCall + fetch * pricing.fetchCall;
}

/** Guarda el consumo de cada llamada a la IA y aplica los límites de gasto. */
export function createCostTracker(db, { pricing, budget, timeZone, now = Date.now }) {
  const insert = db.prepare(`INSERT INTO ai_usage
    (created_at, day, install_id, kind, provider, model, input_tokens, cached_tokens, output_tokens,
     search_calls, fetch_calls, from_cache, cost_usd)
    VALUES (@createdAt, @day, @installId, @kind, @provider, @model, @input, @cached, @output,
     @search, @fetch, @fromCache, @cost)`);
  const spentSince = db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE day >= ?');

  const sumColumns = `COUNT(*) AS calls, SUM(from_cache) AS cacheHits,
    COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(cached_tokens), 0) AS cached,
    COALESCE(SUM(output_tokens), 0) AS output, COALESCE(SUM(search_calls), 0) AS search,
    COALESCE(SUM(fetch_calls), 0) AS fetch, COALESCE(SUM(cost_usd), 0) AS cost`;
  const totalsSince = db.prepare(`SELECT ${sumColumns} FROM ai_usage WHERE day >= ?`);
  const byDay = db.prepare(`SELECT day, ${sumColumns} FROM ai_usage WHERE day >= ? GROUP BY day ORDER BY day DESC`);
  const byKind = db.prepare(`SELECT kind, ${sumColumns} FROM ai_usage WHERE day >= ? GROUP BY kind ORDER BY cost DESC`);
  const byModel = db.prepare(`SELECT provider, model, ${sumColumns} FROM ai_usage WHERE day >= ? GROUP BY provider, model ORDER BY cost DESC`);
  const byInstall = db.prepare(`SELECT install_id AS installId, ${sumColumns} FROM ai_usage WHERE day >= ?
    GROUP BY install_id ORDER BY cost DESC LIMIT 10`);

  const today = () => dayKey(now(), timeZone);
  const monthStart = () => `${today().slice(0, 7)}-01`;

  function record({ installId, kind, provider, model, tokens = {}, search = 0, fetch = 0, fromCache = false }) {
    const usage = { input: tokens.input || 0, cached: tokens.cached || 0, output: tokens.output || 0, search, fetch };
    const t = now();
    insert.run({
      createdAt: t,
      day: dayKey(t, timeZone),
      installId: installId || 'unknown',
      kind: kind || 'prompt',
      provider,
      model,
      ...usage,
      fromCache: fromCache ? 1 : 0,
      cost: fromCache ? 0 : costOf(usage, pricing),
    });
  }

  function spent() {
    return { today: spentSince.get(today()).total, month: spentSince.get(monthStart()).total };
  }

  return {
    record,
    spent,

    /** Lanza 429 si se ha superado el límite de gasto diario o mensual. */
    assertWithinBudget() {
      const { today: day, month } = spent();
      if (budget.dailyUsd > 0 && day >= budget.dailyUsd) {
        throw new HttpError(429, 'BUDGET_EXCEEDED',
          `Se ha alcanzado el límite de gasto diario de la IA ($${budget.dailyUsd}). Vuelve mañana.`);
      }
      if (budget.monthlyUsd > 0 && month >= budget.monthlyUsd) {
        throw new HttpError(429, 'BUDGET_EXCEEDED',
          `Se ha alcanzado el límite de gasto mensual de la IA ($${budget.monthlyUsd}).`);
      }
    },

    /** Middleware de Express equivalente a assertWithinBudget(). */
    budgetMiddleware() {
      return (_req, _res, next) => {
        try {
          this.assertWithinBudget();
          next();
        } catch (error) {
          next(error);
        }
      };
    },

    report(days = 30) {
      const from = dayKey(now() - (days - 1) * 86_400_000, timeZone);
      return {
        today: today(),
        timeZone,
        pricing,
        budget,
        totals: {
          today: totalsSince.get(today()),
          month: totalsSince.get(monthStart()),
          all: totalsSince.get('0000-00-00'),
        },
        byDay: byDay.all(from),
        byKind: byKind.all(monthStart()),
        byModel: byModel.all(monthStart()),
        byInstall: byInstall.all(monthStart()),
      };
    },
  };
}
