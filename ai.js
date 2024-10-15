import axios from 'axios';
import { config } from 'dotenv';

// Configura dotenv
config();

// Obtén la clave API de las variables de entorno
const apiKey = process.env.OPENAI_API_KEY;

const test = false;

const chatHistory = {};

export async function requestIA(idChat, prompt) {
    const chatHistory = getChatHistory(idChat);

    chatHistory.push({ role: 'user', content: prompt });

    if (test) return { chatHistory };

    const requestCached = getRequestCached(prompt);
    if (requestCached) {
        console.log('cached', requestCached);
        chatHistory.push({ role: 'assistant', content: requestCached });
        return { chatHistory };
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

        chatHistory.push({ role: 'assistant', content: reply });

        return { chatHistory };
    } catch (error) {
        throw new Error(`Error al hacer la solicitud a ChatGPT: ${error.message}`);
    }
}

function getChatHistory(idChatContext) {
    if (!chatHistory[idChatContext]) chatHistory[idChatContext] = [];
    return chatHistory[idChatContext];
}

function getRequestCached(searchContent) {
    // Recorremos las propiedades del objeto
    for (const key in chatHistory) {
        const conversation = chatHistory[key];

        // Recorremos los elementos de cada conversación
        for (let i = 0; i < conversation.length; i++) {
            // Si encontramos el content que estamos buscando
            if (conversation[i].content === searchContent) {
                // Nos aseguramos de que exista un siguiente elemento y que sea 'assistant'
                if (i + 1 < conversation.length && conversation[i + 1].role === 'assistant') {
                    return conversation[i + 1].content;
                }
            }
        }
    }
    // Si no encontramos coincidencias, devolvemos null
    return null;
}