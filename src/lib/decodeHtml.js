const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?\s*([\w:.-]+)/i;

function decoderFor(label) {
  try {
    return new TextDecoder(String(label).trim().toLowerCase());
  } catch {
    return null;
  }
}

/**
 * Convierte el HTML descargado a texto respetando su codificación. Muchas webs
 * españolas siguen usando ISO-8859-1/15 o Windows-1252: leídas como UTF-8 pierden
 * las tildes y la ñ («Snchez»). Orden: cabecera Content-Type, <meta charset> y,
 * si no se declara nada, UTF-8 con respaldo a Windows-1252 si los bytes no son UTF-8.
 */
export function decodeHtml(data, contentType = '') {
  if (typeof data === 'string') return data;
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);

  const declared = String(contentType).match(/charset\s*=\s*["']?([\w:.-]+)/i)?.[1]
    || bytes.subarray(0, 4096).toString('latin1').match(META_CHARSET)?.[1];
  const decoder = declared && decoderFor(declared);
  if (decoder) return decoder.decode(bytes);

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
