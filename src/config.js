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

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function loadConfig() {
  return Object.freeze({
    port: int('PORT', 3000),
    // Por defecto solo escucha en esta máquina. Docker lo cambia a 0.0.0.0.
    host: process.env.HOST || process.env.IP || '127.0.0.1',
    dbPath: process.env.DB_PATH || 'data/muchotexto.db',

    ai: {
      provider: process.env.AI_PROVIDER || 'deepseek',
      model: process.env.AI_MODEL || '',
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
