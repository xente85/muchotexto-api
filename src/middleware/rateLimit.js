import { HttpError } from '../lib/httpError.js';
import { dayKey } from '../services/costTracker.js';

/**
 * Límite de peticiones por minuto en memoria, por instalación y por IP.
 * La IP evita que alguien se salte el límite generando identificadores nuevos.
 */
export function rateLimitMiddleware({ perMinute, now = Date.now }) {
  const windows = new Map();
  const windowMs = 60_000;

  function hit(key) {
    const t = now();
    const recent = (windows.get(key) || []).filter((ts) => t - ts < windowMs);
    recent.push(t);
    windows.set(key, recent);
    return recent.length;
  }

  // Limpieza periódica para que el mapa no crezca sin control.
  const timer = setInterval(() => {
    const t = now();
    for (const [key, stamps] of windows) {
      if (!stamps.some((ts) => t - ts < windowMs)) windows.delete(key);
    }
  }, windowMs);
  timer.unref();

  const middleware = (req, res, next) => {
    if (perMinute === 0) return next();
    const byInstall = hit(`i:${req.installId}`);
    // La IP admite varias instalaciones detrás del mismo router.
    const byIp = hit(`ip:${req.ip}`);
    if (byInstall > perMinute || byIp > perMinute * 5) {
      res.set('Retry-After', '60');
      return next(new HttpError(429, 'RATE_LIMITED', 'Demasiadas peticiones seguidas. Espera un minuto e inténtalo de nuevo.'));
    }
    return next();
  };
  middleware.stop = () => clearInterval(timer);
  return middleware;
}

/** Cuota diaria por instalación guardada en SQLite. */
export function createUsageTracker(db, { timeZone = 'UTC' } = {}) {
  const increment = db.prepare(`INSERT INTO usage (install_id, day, kind, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(install_id, day, kind) DO UPDATE SET count = count + 1 RETURNING count`);
  const decrement = db.prepare('UPDATE usage SET count = MAX(count - 1, 0) WHERE install_id = ? AND day = ? AND kind = ?');
  const today = () => dayKey(Date.now(), timeZone);

  return {
    /** Middleware que consume una unidad de la cuota `kind`. */
    quota(kind, limit) {
      return (req, _res, next) => {
        if (limit === 0) return next();
        const day = today();
        const { count } = increment.get(req.installId, day, kind);
        if (count > limit) {
          decrement.run(req.installId, day, kind);
          return next(new HttpError(429, 'QUOTA_EXCEEDED',
            `Has alcanzado el límite diario de ${limit} ${kind === 'factCheck' ? 'análisis de evidencias' : 'peticiones'}. Vuelve mañana.`));
        }
        return next();
      };
    },
  };
}
