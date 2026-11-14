import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/httpError.js';

/**
 * Trabajos en segundo plano en memoria (un solo proceso).
 * Limita cuántos se ejecutan a la vez y los borra al caducar o al leerse.
 */
export function createJobQueue({ maxConcurrent, ttlMs }) {
  const jobs = new Map();
  let running = 0;

  function expire(id) {
    const timer = setTimeout(() => jobs.delete(id), ttlMs);
    timer.unref();
  }

  return {
    /** Lanza `task()` y devuelve el id del trabajo. */
    start(ownerId, task) {
      if (maxConcurrent > 0 && running >= maxConcurrent) {
        throw new HttpError(429, 'BUSY', 'Hay demasiados análisis en curso. Inténtalo en un momento.');
      }
      const id = randomUUID();
      jobs.set(id, { ownerId, status: 'pending' });
      expire(id);
      running += 1;

      Promise.resolve()
        .then(task)
        .then((result) => {
          if (jobs.has(id)) jobs.set(id, { ownerId, status: 'completed', result });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Error desconocido.';
          if (jobs.has(id)) jobs.set(id, { ownerId, status: 'failed', error: message });
        })
        .finally(() => { running -= 1; });

      return id;
    },

    /** Estado del trabajo; los terminados se borran tras leerse. */
    take(id, ownerId) {
      const job = jobs.get(id);
      if (!job || job.ownerId !== ownerId) return null;
      if (job.status !== 'pending') jobs.delete(id);
      return job;
    },

    get running() {
      return running;
    },
  };
}
