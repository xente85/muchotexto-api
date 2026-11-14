import axios from 'axios';
import { HttpError } from '../lib/httpError.js';

export const PROVIDERS = {
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-v4-flash',
  },
  kimi: {
    url: 'https://api.moonshot.ai/v1/chat/completions',
    defaultModel: 'kimi-k2.6',
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-3.5-turbo',
  },
};

function upstreamMessage(error, providerName) {
  const status = error?.response?.status;
  if (status === 401 || status === 403) return `La API key de ${providerName} no es válida o no tiene permisos.`;
  if (status === 402) return `La cuenta de ${providerName} no tiene saldo suficiente.`;
  if (status === 429) return `${providerName} está limitando las peticiones. Inténtalo en unos minutos.`;
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') return `${providerName} ha tardado demasiado en responder.`;
  if (status) return `${providerName} ha devuelto un error (${status}).`;
  return `No se pudo conectar con ${providerName}.`;
}

/**
 * Cliente de chat-completions compatible con DeepSeek, Kimi y OpenAI.
 * `config` es la sección `ai` de loadConfig().
 */
export function createAiClient(config) {
  const providerName = config.provider;
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Proveedor de IA no soportado: ${providerName}`);

  const apiKey = config.keys[providerName];
  const model = config.model || provider.defaultModel;
  const url = config.baseUrl || provider.url;

  async function complete(messages, maxTokens) {
    if (!apiKey) {
      throw new HttpError(503, 'AI_NOT_CONFIGURED', `Falta configurar la API key del proveedor de IA (${providerName}).`);
    }

    const body = { model, messages, max_tokens: maxTokens };
    // DeepSeek V4 razona por defecto; para resúmenes y traducciones
    // interesa reservar todos los tokens para la respuesta.
    if (providerName === 'deepseek') body.thinking = { type: 'disabled' };

    let response;
    try {
      response = await axios.post(url, body, {
        timeout: config.timeoutMs,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('[ai] request.failed', {
        provider: providerName,
        model,
        status: error?.response?.status,
        code: error?.code,
      });
      throw new HttpError(502, 'AI_UPSTREAM_ERROR', upstreamMessage(error, providerName));
    }

    const choice = response.data?.choices?.[0];
    return {
      reply: typeof choice?.message?.content === 'string' ? choice.message.content : '',
      finishReason: choice?.finish_reason,
    };
  }

  /** Pide una respuesta; si llega vacía o cortada, reintenta una vez con más tokens. */
  async function chat(messages, maxTokens = config.maxTokens) {
    let result = await complete(messages, maxTokens);

    if (!result.reply.trim() || result.finishReason === 'length') {
      const retryMaxTokens = Math.max(maxTokens * 2, 1000);
      console.warn('[ai] reply.retry', { provider: providerName, model, finishReason: result.finishReason, retryMaxTokens });
      result = await complete(messages, retryMaxTokens);
    }

    if (!result.reply.trim()) {
      throw new HttpError(502, 'AI_EMPTY_REPLY', `El proveedor devolvió una respuesta vacía (finish_reason: ${result.finishReason || 'desconocido'}).`);
    }
    if (result.finishReason === 'length') {
      throw new HttpError(502, 'AI_TRUNCATED', 'El proveedor agotó el límite de tokens antes de completar la respuesta.');
    }
    return result.reply;
  }

  return {
    providerName,
    model,
    chat,
    /** Una pregunta sin historial. */
    ask(prompt, maxTokens) {
      return chat([{ role: 'user', content: prompt }], maxTokens);
    },
  };
}
