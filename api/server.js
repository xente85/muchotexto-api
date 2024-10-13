import express from 'express'
import { requestIA } from './ai.js';

import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';

const app = express()
const port = process.env.PORT || 3000
const host = process.env.IP

app.use(express.json())

app.post('/link', async (req, res) => {
  console.log(req.body);
  const data = req.body;
  
  try {
    const { link } = data;

    const response = await axios.get(link);
    const dom = new JSDOM(response.data);
    const document = dom.window.document;
    const reader = new Readability(document);
    const article = reader.parse();

    // Si no se pudo extraer el artículo, devolvemos un error
    if (!article) {
      res.json({ error: "Could not extract article" });
      return;
    }

    // Cargar el contenido del artículo en Cheerio
    const $ = cheerio.load(article.content);

    // Eliminar todos los comentarios del HTML extraído
    $('*').contents().each(function() {
      if (this.type === 'comment') {
        $(this).remove();
      }
    });

    // Eliminar todas las etiquetas <img>
    $('img').remove();

    // Eliminar etiquetas no esenciales (html, head, body, divs sin contenido)
    $('[class], [id], [rel], [alt], [srcset], [href]').removeAttr('class id rel alt srcset href');

    // Eliminar etiquetas vacías
    $('*:empty').remove();

    // Comprimir el HTML eliminando saltos de línea y espacios innecesarios
    const cleanedHTML = $.html().replace(/\n/g, '').replace(/\s\s+/g, ' ').trim();

    // Reemplazar el contenido del artículo con el HTML limpio y comprimido
    article.content = cleanedHTML;

    // Devolver el artículo limpio como respuesta
    res.json(article);
  } catch (error) {
    console.error(error)
    res.json({ error })
  }
})

app.post('/prompt', async (req, res) => {
  console.log(req.body);
  const data = req.body;
  
  try {
    const { prompt, idChat } = data;
    const { chatHistory } = await requestIA(idChat, prompt);
    console.log('response', { idChat, chatHistory });
    res.json({ chatHistory });
  } catch (error) {
    console.error(error)
    res.json({ error })
  }
})

// Endpoint que hace una solicitud a Ollama
app.post('/summarize', async (req, res) => {
  const userInput = req.body.prompt; // Obtén el input del usuario desde el cuerpo de la solicitud

  try {
      const response = await axios.post('http://localhost:5000/summarize', {
          text: userInput,
      });

      res.json(response.data); // Devuelve la respuesta de Ollama al cliente
  } catch (error) {
      console.error('Error al comunicarse con Ollama:', error);
      res.status(500).json({ error: 'Error al comunicarse con Ollama' });
  }
});

// Endpoint que hace una solicitud a Ollama
app.post('/translate', async (req, res) => {
  const userInput = req.body.prompt; // Obtén el input del usuario desde el cuerpo de la solicitud

  try {
      const response = await axios.post('http://localhost:5000/translate', {
          text: userInput,
      });

      res.json(response.data); // Devuelve la respuesta de Ollama al cliente
  } catch (error) {
      console.error('Error al comunicarse con Ollama:', error);
      res.status(500).json({ error: 'Error al comunicarse con Ollama' });
  }
});

app.listen(port, host, () => {
  console.log(`Example app listening on port ${port}`)
})