import axios from 'axios';
import { config } from 'dotenv';

// Configura dotenv
config();

// Obtén la clave API de las variables de entorno
const apiKey = process.env.OPENAI_API_KEY;

const test = false;

export async function requestIA(prompt) {
    if (test) return prompt;
    
    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }]
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        const reply = response.data.choices[0].message.content;
        return reply;
    } catch (error) {
        throw new Error(`Error al hacer la solicitud a ChatGPT: ${error.message}`);
    }
}