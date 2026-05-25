import express from 'express'
import { requestIA } from './ai.js';

import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';

const app = express()
const port = process.env.PORT || 3000
const host = process.env.IP

const articlesCached = {};
const AXIOS_TIMEOUT_MS = 10000;

app.use(express.json())

function parseHttpUrl(link) {
  try {
    const url = new URL(link);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function cleanArticleHTML(html) {
  const $ = cheerio.load(html);

  $('*').contents().each(function() {
    if (this.type === 'comment') {
      $(this).remove();
    }
  });

  $('img').remove();
  $('[class], [id], [rel], [alt], [srcset], [href]').removeAttr('class id rel alt srcset href');
  $('*:empty').remove();

  return $.html().replace(/\n/g, '').replace(/\s\s+/g, ' ').trim();
}

function isProtectedByAntiBot(error) {
  if (!axios.isAxiosError(error)) return false;

  const headers = error.response?.headers || {};
  const data = error.response?.data;

  return error.response?.status === 403 && (
    headers['x-datadome'] === 'protected' ||
    headers['x-dd-b'] ||
    data?.url?.includes('captcha-delivery.com')
  );
}

function publicError(error) {
  if (isProtectedByAntiBot(error)) {
    return {
      code: 'ARTICLE_PROTECTED',
      error: 'La web ha bloqueado la lectura automática del artículo con una protección anti-bot/captcha.',
    };
  }

  if (axios.isAxiosError(error)) {
    return {
      code: 'ARTICLE_REQUEST_FAILED',
      error: `No se pudo descargar el artículo${error.response?.status ? ` (${error.response.status})` : ''}.`,
    };
  }

  return {
    code: 'ARTICLE_ERROR',
    error: error instanceof Error ? error.message : 'Error desconocido al procesar el artículo.',
  };
}

app.post('/link', async (req, res) => {
  console.log(req.body);
  const data = req.body;
  
  try {
    const { link } = data;
    const url = parseHttpUrl(link);

    if (!url) {
      return res.json({
        code: 'INVALID_LINK',
        error: 'El enlace debe ser una URL http o https válida.',
      });
    }

    if (articlesCached[link]) {
      console.log('cached', link);
      return res.json(articlesCached[link]);
    }

    const response = await axios.get(url.href, {
      timeout: AXIOS_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: 5 * 1024 * 1024,
    });
    const dom = new JSDOM(response.data);
    const document = dom.window.document;
    const reader = new Readability(document);
    const article = reader.parse();

    // Si no se pudo extraer el artículo, devolvemos un error
    if (!article) {
      res.json({ error: "Could not extract article" });
      return;
    }

    // Reemplazar el contenido del artículo con el HTML limpio y comprimido
    article.content = cleanArticleHTML(article.content);

    // Cacheamos la respuesta
    articlesCached[link] = article;

    // Devolver el artículo limpio como respuesta
    res.json(article);
  } catch (error) {
    console.error(error)
    res.json(publicError(error))
  }
})

app.post('/prompt', async (req, res) => {
  console.log(req.body);
  const data = req.body;
  
  try {
    const modelo = 'gpt-3.5-turbo';
    const max_tokens = 500;
    const { prompt, idChat } = data;
    const { chatHistory } = await requestIA(idChat, prompt, modelo, max_tokens);
    console.log('response', { idChat, chatHistory, modelo, max_tokens });
    res.json({ chatHistory });
  } catch (error) {
    console.error(error)
    res.json({
      error: error instanceof Error ? error.message : 'Error desconocido al llamar a la IA.',
    })
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
