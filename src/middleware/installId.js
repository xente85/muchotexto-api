import { HttpError } from '../lib/httpError.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identifica la instalación de la extensión con la cabecera X-Install-Id.
 * Es un identificador anónimo, no una contraseña: sirve para cuotas y para
 * que una instalación no pueda leer conversaciones de otra.
 */
export function installIdMiddleware({ required }) {
  return (req, _res, next) => {
    const header = req.get('X-Install-Id');
    if (header && UUID.test(header)) {
      req.installId = header.toLowerCase();
      return next();
    }
    if (required) {
      return next(new HttpError(401, 'INSTALL_ID_REQUIRED',
        'Falta el identificador de instalación. Actualiza o recarga la extensión.'));
    }
    req.installId = `anon:${req.ip}`;
    return next();
  };
}
