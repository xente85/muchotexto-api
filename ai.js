import axios from 'axios';
import { config } from 'dotenv';
import { addChat, getRequestCached } from './bd.js';

// Configura dotenv
config();

const providers = {
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        url: 'https://api.openai.com/v1/chat/completions',
        defaultModel: 'gpt-3.5-turbo',
    },
    deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY,
        url: 'https://api.deepseek.com/chat/completions',
        defaultModel: 'deepseek-v4-flash',
    },
    kimi: {
        apiKey: process.env.MOONSHOT_API_KEY,
        url: 'https://api.moonshot.ai/v1/chat/completions',
        defaultModel: 'kimi-k2.6',
    },
};

const test = false;

function getProvider(providerName = 'deepseek') {
    const provider = providers[providerName];
    if (!provider) {
        throw new Error(`Proveedor de IA no soportado: ${providerName}`);
    }
    if (!provider.apiKey) {
        throw new Error(`Falta configurar la API key para el proveedor de IA: ${providerName}`);
    }
    return provider;
}

async function requestCompletion(provider, providerName, model, messages, max_tokens) {
    const data = {
        model,
        messages,
        max_tokens
    };

    // Los modelos DeepSeek V4 razonan por defecto. Para resúmenes y
    // traducciones breves interesa reservar todos los tokens para la respuesta.
    if (providerName === 'deepseek') {
        data.thinking = { type: 'disabled' };
    }

    const response = await axios.post(
        provider.url,
        data,
        {
            headers: {
                'Authorization': `Bearer ${provider.apiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );
    const choice = response.data?.choices?.[0];

    return {
        reply: typeof choice?.message?.content === 'string' ? choice.message.content : '',
        finishReason: choice?.finish_reason
    };
}

export async function requestIA(idChat, prompt, modelo, max_tokens = 500, providerName = 'deepseek') {
    const chat = addChat(idChat, { role: 'user', content: prompt });

    if (test) return { chatHistory: chat };

    const provider = getProvider(providerName);
    const model = modelo || provider.defaultModel;

    // console.log('requestIA', { provider, model });

    const requestCached = getRequestCached(prompt, idChat);
    if (requestCached) {
        // console.log('cached', requestCached);
        return { chatHistory: addChat(idChat, { role: 'assistant', content: requestCached }) };
    }

    try {
        let result = await requestCompletion(provider, providerName, model, chat, max_tokens);

        if (!result.reply.trim() || result.finishReason === 'length') {
            const retryMaxTokens = Math.max(max_tokens * 2, 1000);
            console.warn('Respuesta de IA vacía o truncada; reintentando', {
                provider: providerName,
                model,
                finishReason: result.finishReason,
                maxTokens: max_tokens,
                retryMaxTokens
            });
            result = await requestCompletion(provider, providerName, model, chat, retryMaxTokens);
        }

        if (!result.reply.trim()) {
            throw new Error(`El proveedor devolvió una respuesta vacía (finish_reason: ${result.finishReason || 'desconocido'})`);
        }

        if (result.finishReason === 'length') {
            throw new Error('El proveedor agotó el límite de tokens antes de completar la respuesta');
        }

        return { chatHistory: addChat(idChat, { role: 'assistant', content: result.reply }) };
    } catch (error) {
        throw new Error(`Error al hacer la solicitud a ${providerName}/${model}: ${error.message}`);
    }
}
