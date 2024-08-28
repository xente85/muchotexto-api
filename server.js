import express from 'express'
import { requestIA } from './ai.js';

import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import cheerio from 'cheerio';

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

    // Reemplazar el contenido del artículo con el HTML limpio
    article.content = $.html();

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
    const { prompt } = data;
    const response = await requestIA(prompt);
    console.log('response', response);
    res.json({ response })
  } catch (error) {
    console.error(error)
    res.json({ error })
  }
})

app.listen(port, host, () => {
  console.log(`Example app listening on port ${port}`)
})