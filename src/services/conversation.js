import { HttpError } from '../lib/httpError.js';

/**
 * Mensajes que se envían al proveedor: el primero (normalmente el artículo o
 * el texto seleccionado) y los últimos `maxMessages`. Evita que el coste crezca
 * sin límite en conversaciones largas.
 */
export function trimHistory(messages, maxMessages) {
  if (messages.length <= maxMessages + 1) return messages;
  return [messages[0], ...messages.slice(-maxMessages)];
}

export function createConversationService({ ai, chatStore, limits, retention, costs }) {
  return {
    /** Añade `prompt` a la conversación `chatId`, pide respuesta y devuelve el historial. */
    async reply({ chatId, installId, prompt }) {
      if (typeof chatId !== 'string' || !chatId || chatId.length > 100) {
        throw new HttpError(400, 'INVALID_CHAT', 'Falta el identificador de la conversación.');
      }
      if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new HttpError(400, 'INVALID_PROMPT', 'El mensaje está vacío.');
      }
      if (prompt.length > limits.maxPromptChars) {
        throw new HttpError(413, 'PROMPT_TOO_LONG', 'El texto es demasiado largo para procesarlo.');
      }

      const history = chatStore.getMessages(chatId, installId);
      const isFirstMessage = history.length === 0;
      const userMessage = { role: 'user', content: prompt };

      // Los primeros mensajes (resumir un artículo, traducir un texto) se repiten
      // mucho entre usuarios: se reutiliza la respuesta si ya se pidió antes.
      const cacheKey = isFirstMessage ? chatStore.cacheKey(ai.providerName, ai.model, prompt) : null;
      let reply = cacheKey ? chatStore.getCachedReply(cacheKey, retention.responseCacheTtlDays) : null;

      if (reply) {
        // Respuesta reutilizada: no cuesta tokens, pero se anota para ver el ahorro.
        costs?.record({ installId, kind: 'prompt', provider: ai.providerName, model: ai.model, fromCache: true });
      } else {
        reply = await ai.chat(trimHistory([...history, userMessage], limits.maxChatMessages), undefined, { installId, kind: 'prompt' });
        if (cacheKey) chatStore.cacheReply(cacheKey, reply);
      }

      // Se guarda la pareja pregunta/respuesta solo cuando hay respuesta,
      // así un error no deja mensajes de usuario huérfanos en el historial.
      chatStore.addMessage(chatId, installId, userMessage);
      return chatStore.addMessage(chatId, installId, { role: 'assistant', content: reply });
    },
  };
}
