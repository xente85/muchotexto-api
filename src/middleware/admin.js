import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { HttpError } from '../lib/httpError.js';
import { isPrivateAddress } from '../lib/safeUrl.js';

function sameToken(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Acceso a /admin. Con ADMIN_TOKEN hay que enviarlo (?token= o cabecera
 * Authorization: Bearer). Sin token, solo desde esta máquina o la red local
 * (Docker llega desde una IP privada).
 */
export function adminMiddleware({ token }) {
  return (req, _res, next) => {
    if (token) {
      const given = req.query.token || req.get('Authorization')?.replace(/^Bearer\s+/i, '');
      if (given && sameToken(given, token)) return next();
      return next(new HttpError(401, 'ADMIN_UNAUTHORIZED', 'Falta el token de administración o no es válido.'));
    }
    const ip = req.socket.remoteAddress || '';
    if (isIP(ip) && isPrivateAddress(ip)) return next();
    return next(new HttpError(403, 'ADMIN_FORBIDDEN', 'Configura ADMIN_TOKEN para ver el consumo desde fuera de esta máquina.'));
  };
}
