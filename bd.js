import { readFileSync, writeFileSync, existsSync } from 'fs';

const fileName = 'chatHistory.json';

// Función para leer el archivo JSON
function getChatHistory() {
  // Verificar si el archivo existe
  if (!existsSync(fileName)) {
    console.log(`Creamos la bd: ${fileName}`);
    // Si el archivo no existe, crearlo con un contenido inicial vacío
    const initialData = {}; // Estructura inicial de tu archivo JSON
    setChatHistory(initialData);
    return initialData;
  }

  const data = readFileSync(fileName);
  return JSON.parse(data);
}

// Función para escribir en el archivo JSON
function setChatHistory(newData) {
  writeFileSync(fileName, JSON.stringify(newData, null, 2));
}

// Función para agregar un nuevo usuario
function addChat(idChat, data) {
  const chatHistory = getChatHistory();  // Obtén los datos actuales

  if (!chatHistory[idChat]) chatHistory[idChat] = [];
  
  chatHistory[idChat].push(data);
  
  setChatHistory(chatHistory);  // Guardar los cambios

  return chatHistory[idChat];
}

function getRequestCached(searchContent, idChat) {
  const chatHistory = getChatHistory();

  // Recorremos las propiedades del objeto
  for (const key in chatHistory) {
      const conversation = chatHistory[key];

      console.log('getRequestCached', { key, conversation });

      // Recorremos los elementos de cada conversación
      for (let i = 0; i < conversation.length; i++) {
          if (i > 0 && key !== idChat) continue;

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

export { addChat, getRequestCached };