import express from 'express'
import { randomBytes } from 'crypto';
import { requestIA } from './ai.js';
import { factCheckArticle } from './factCheck.js';

import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';

const app = express()
const port = process.env.PORT || 3000
const host = process.env.IP

const articlesCached = {};
const AXIOS_TIMEOUT_MS = 10000;
const factCheckJobs = new Map();
const FACT_CHECK_JOB_TTL_MS = 10 * 60 * 1000;

app.use(express.json({ limit: '1mb' }))

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
  // console.log(req.body);
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
      // console.log('cached', link);
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
  // console.log(req.body);
  const data = req.body;
  
  try {
    const provider = process.env.AI_PROVIDER || 'deepseek';
    const modelo = process.env.AI_MODEL;
    const max_tokens = Number(process.env.AI_MAX_TOKENS || 500);
    const { prompt, idChat } = data;
    const { chatHistory } = await requestIA(idChat, prompt, modelo, max_tokens, provider);
    // console.log('response', { idChat, chatHistory, provider, modelo, max_tokens });
    res.json({ chatHistory });
  } catch (error) {
    console.error(error)
    res.json({
      error: error instanceof Error ? error.message : 'Error desconocido al llamar a la IA.',
    })
  }
})

app.post('/fact-check', async (req, res) => {
  const requestId = randomBytes(4).toString('hex');
  const startedAt = Date.now();
  console.log(`[fact-check][${requestId}] request.received`, {
    hasIdChat: Boolean(req.body?.idChat),
    hasArticle: Boolean(req.body?.article),
    articleChars: req.body?.article?.content?.length || req.body?.article?.textContent?.length || 0,
    locale: req.body?.locale || 'unknown',
  });
  const { idChat, article, locale } = req.body;
  if (!idChat || !article) {
    return res.status(400).json({ error: 'Faltan idChat o article.' });
  }

  factCheckJobs.set(requestId, { status: 'pending', createdAt: Date.now() });
  const cleanupTimer = setTimeout(() => factCheckJobs.delete(requestId), FACT_CHECK_JOB_TTL_MS);
  cleanupTimer.unref();
  res.status(202).json({ jobId: requestId, status: 'pending' });
  console.log(`[fact-check][${requestId}] request.accepted`, { status: 202 });

  try {
    const provider = process.env.AI_PROVIDER || 'deepseek';
    const model = process.env.AI_MODEL;
    const maxTokens = Number(process.env.FACT_CHECK_MAX_TOKENS || 1600);
    const { chatHistory } = await factCheckArticle({
      idChat,
      article,
      locale,
      provider,
      model,
      maxTokens,
      requestId,
    });
    factCheckJobs.set(requestId, { status: 'completed', chatHistory, createdAt: Date.now() });
    console.log(`[fact-check][${requestId}] request.completed`, {
      durationMs: Date.now() - startedAt,
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al verificar el artículo.';
    factCheckJobs.set(requestId, { status: 'failed', error: message, createdAt: Date.now() });
    console.error(`[fact-check][${requestId}] request.failed`, {
      durationMs: Date.now() - startedAt,
      upstreamStatus: error?.response?.status,
      code: error?.code,
      message,
    });
  }
})

app.get('/fact-check/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = factCheckJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'La verificación no existe o ha caducado.' });
  }
  if (job.status === 'pending') {
    return res.status(202).json({ jobId, status: 'pending' });
  }

  factCheckJobs.delete(jobId);
  if (job.status === 'failed') {
    return res.status(502).json({ error: job.error });
  }
  return res.json({ chatHistory: job.chatHistory });
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
