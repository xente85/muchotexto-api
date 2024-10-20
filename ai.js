import axios from 'axios';
import { config } from 'dotenv';
import { addChat, getRequestCached } from './bd.js';

// Configura dotenv
config();

// Obtén la clave API de las variables de entorno
const apiKey = process.env.OPENAI_API_KEY;

const test = false;

const chatHistory = {};

export async function requestIA(idChat, prompt) {
    const chat = addChat(idChat, { role: 'user', content: prompt });

    if (test) return { chat };

    const requestCached = getRequestCached(prompt, idChat);
    if (requestCached) {
        console.log('cached', requestCached);
        return { chat: addChat(idChat, { role: 'assistant', content: requestCached }) };
    }

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-3.5-turbo',
                messages: chatHistory,
                max_tokens: 100
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        const reply = response.data.choices[0].message.content;

        return { chat: addChat(idChat, { role: 'assistant', content: reply }) };
    } catch (error) {
        throw new Error(`Error al hacer la solicitud a ChatGPT: ${error.message}`);
    }
}
