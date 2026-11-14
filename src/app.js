import express from 'express';
import { HttpError } from './lib/httpError.js';
import { installIdMiddleware } from './middleware/installId.js';
import { rateLimitMiddleware, createUsageTracker } from './middleware/rateLimit.js';
import { adminMiddleware } from './middleware/admin.js';
import { factCheckArticle } from './services/factCheck.js';
import { renderUsagePage } from './views/usagePage.js';

/**
 * Crea la app de Express. Las dependencias se inyectan para poder probarla
 * sin llamar a proveedores reales.
 */
export function createApp({ config, db, ai, chatStore, articles, conversation, factCheckJobs, costs, runFactCheck = factCheckArticle }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', provider: ai.providerName, model: ai.model });
  });

  // Consumo y coste de la IA. Va antes de X-Install-Id porque se abre desde el navegador.
  const admin = adminMiddleware({ token: config.adminToken });
  app.get('/admin', admin, (req, res) => {
    const jsonHref = `/admin/usage.json${req.query.token ? `?token=${encodeURIComponent(req.query.token)}` : ''}`;
    res.type('html').send(renderUsagePage(costs.report(), { jsonHref }));
  });
  app.get('/admin/usage.json', admin, (_req, res) => res.json(costs.report()));

  const usage = createUsageTracker(db, { timeZone: config.timeZone });
  const withinBudget = costs.budgetMiddleware();
  const rateLimit = rateLimitMiddleware({ perMinute: config.limits.requestsPerMinute });
  app.locals.stop = () => rateLimit.stop();

  app.use(installIdMiddleware({ required: config.requireInstallId }));

  // La extensión consulta este endpoint cada pocos segundos: queda fuera del límite por minuto.
  app.get('/fact-check/:jobId', (req, res) => {
    const job = factCheckJobs.take(req.params.jobId, req.installId);
    if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'La verificación no existe o ha caducado.');
    if (job.status === 'pending') return res.status(202).json({ jobId: req.params.jobId, status: 'pending' });
    if (job.status === 'failed') throw new HttpError(502, 'FACT_CHECK_FAILED', job.error);
    return res.json(job.result);
  });

  app.use(rateLimit);

  app.post('/link', async (req, res) => {
    res.json(await articles.get(req.body?.link));
  });

  app.post('/prompt', withinBudget, usage.quota('prompt', config.limits.dailyQuota), async (req, res) => {
    const { prompt, idChat } = req.body || {};
    const chatHistory = await conversation.reply({ chatId: idChat, installId: req.installId, prompt });
    res.json({ chatHistory });
  });

  app.post('/fact-check', withinBudget, usage.quota('factCheck', config.limits.factCheckDailyQuota), (req, res) => {
    const { idChat, article, locale } = req.body || {};
    if (typeof idChat !== 'string' || !idChat || !article || typeof article !== 'object') {
      throw new HttpError(400, 'INVALID_REQUEST', 'Faltan idChat o article.');
    }
    if (!config.ai.keys.deepseek) {
      throw new HttpError(503, 'SEARCH_NOT_CONFIGURED', 'El análisis de evidencias necesita DEEPSEEK_API_KEY para buscar en la web.');
    }
    // Comprueba que la conversación no pertenece a otra instalación antes de empezar.
    chatStore.getMessages(idChat, req.installId);

    const startedAt = Date.now();
    const jobId = factCheckJobs.start(req.installId, async () => {
      const { chatHistory } = await runFactCheck({
        idChat,
        installId: req.installId,
        article,
        locale: typeof locale === 'string' ? locale : 'es',
        requestId: idChat.slice(0, 8),
        ai,
        chatStore,
        searchApiKey: config.ai.keys.deepseek,
        toolsUrl: config.ai.toolsUrl,
        costs,
      });
      console.log('[fact-check] job.completed', { durationMs: Date.now() - startedAt });
      return { chatHistory };
    });
    res.status(202).json({ jobId, status: 'pending' });
  });

  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Ruta no encontrada.')));

  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') {
      error = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'El texto enviado es demasiado grande.');
    } else if (error?.type === 'entity.parse.failed') {
      error = new HttpError(400, 'INVALID_JSON', 'La petición no es un JSON válido.');
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (status >= 500) console.error('[http] error', { code: error?.code, message: error?.message });
    res.status(status).json({
      code: error?.code || 'INTERNAL_ERROR',
      error: status === 500 ? 'Error interno del servidor.' : error.message,
    });
  });

  return app;
}
