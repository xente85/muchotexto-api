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
        const response = await axios.post(
            provider.url,
            {
                model,
                messages: chat,
                max_tokens
            },
            {
                headers: {
                    'Authorization': `Bearer ${provider.apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        const reply = response.data.choices[0].message.content;

        return { chatHistory: addChat(idChat, { role: 'assistant', content: reply }) };
    } catch (error) {
        throw new Error(`Error al hacer la solicitud a ${providerName}/${model}: ${error.message}`);
    }
}
