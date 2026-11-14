import { config as loadEnv } from 'dotenv';

loadEnv({ quiet: true });

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`La variable ${name} debe ser un entero positivo (valor actual: "${raw}").`);
  }
  return value;
}

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`La variable ${name} debe ser un número positivo (valor actual: "${raw}").`);
  }
  return value;
}

/** Precios por defecto en USD por millón de tokens (comprobados en noviembre de 2026). */
const DEFAULT_PRICES = {
  'deepseek-v4-flash': { input: 0.14, cachedInput: 0.0028, output: 0.28 },
};

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function loadConfig() {
  const model = process.env.AI_MODEL || '';
  const defaults = DEFAULT_PRICES[model || 'deepseek-v4-flash'] || { input: 0, cachedInput: 0, output: 0 };

  return Object.freeze({
    // Zona horaria para los días y meses de cuotas y consumo.
    timeZone: process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    port: int('PORT', 3000),
    // Por defecto solo escucha en esta máquina. Docker lo cambia a 0.0.0.0.
    host: process.env.HOST || process.env.IP || '127.0.0.1',
    dbPath: process.env.DB_PATH || 'data/muchotexto.db',

    ai: {
      provider: process.env.AI_PROVIDER || 'deepseek',
      model,
      // URL alternativa compatible con OpenAI (p. ej. Ollama: http://localhost:11434/v1/chat/completions).
      baseUrl: process.env.AI_BASE_URL || '',
      maxTokens: int('AI_MAX_TOKENS', 500),
      timeoutMs: int('AI_TIMEOUT_MS', 60_000),
      keys: {
        deepseek: process.env.DEEPSEEK_API_KEY || '',
        openai: process.env.OPENAI_API_KEY || '',
        kimi: process.env.MOONSHOT_API_KEY || '',
      },
    },

    pricing: {
      // USD por millón de tokens. Si no se configuran, se usan los de DEFAULT_PRICES.
      input: num('AI_PRICE_INPUT', defaults.input),
      cachedInput: num('AI_PRICE_CACHED_INPUT', defaults.cachedInput),
      output: num('AI_PRICE_OUTPUT', defaults.output),
      // USD por petición a la búsqueda y lectura web de DeepSeek (análisis de evidencias).
      searchCall: num('SEARCH_PRICE_PER_CALL', 0.00075),
      fetchCall: num('FETCH_PRICE_PER_CALL', 0.00075),
    },

    budget: {
      // Gasto máximo en USD (0 = sin límite). Al superarlo se rechazan peticiones nuevas.
      dailyUsd: num('AI_DAILY_BUDGET_USD', 0),
      monthlyUsd: num('AI_MONTHLY_BUDGET_USD', 0),
    },

    // Protege /admin. Sin token, solo se permite desde esta máquina o la red local.
    adminToken: process.env.ADMIN_TOKEN || '',

    factCheck: {
      maxConcurrent: int('FACT_CHECK_MAX_CONCURRENT', 2),
      jobTtlMs: 10 * 60 * 1000,
    },

    limits: {
      // Tamaño máximo de un mensaje enviado a /prompt.
      maxPromptChars: int('MAX_PROMPT_CHARS', 40_000),
      // Mensajes de una conversación que se envían al proveedor (además del primero).
      maxChatMessages: int('MAX_CHAT_MESSAGES', 12),
      requestsPerMinute: int('RATE_LIMIT_PER_MINUTE', 20),
      dailyQuota: int('DAILY_QUOTA', 200),
      factCheckDailyQuota: int('FACT_CHECK_DAILY_QUOTA', 20),
    },

    retention: {
      chatTtlDays: int('CHAT_TTL_DAYS', 7),
      responseCacheTtlDays: int('RESPONSE_CACHE_TTL_DAYS', 7),
    },

    article: {
      timeoutMs: int('ARTICLE_TIMEOUT_MS', 10_000),
      maxBytes: int('ARTICLE_MAX_BYTES', 5 * 1024 * 1024),
      cacheSize: int('ARTICLE_CACHE_SIZE', 200),
      cacheTtlMs: int('ARTICLE_CACHE_TTL_MINUTES', 60) * 60 * 1000,
      // Permite leer URLs de la red local (192.168.x.x, localhost…). Desactivado por seguridad.
      allowPrivateNetwork: bool('ALLOW_PRIVATE_NETWORK', false),
    },

    requireInstallId: bool('REQUIRE_INSTALL_ID', true),
  });
}
