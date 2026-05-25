/**
 * cfeSender.js — Envío del JSON CFE al módulo Dynamica (DGI)
 *
 * Variables de entorno:
 *   CFE_HABILITADO       — 'true' para habilitar envío (master switch)
 *   CFE_TIMEOUT_MS       — timeout en ms (default 20000)
 *
 *   Ambiente LOCAL:
 *     CFE_API_URL, CFE_API_TOKEN
 *   Ambiente PRUEBAS:
 *     CFE_PRUEBAS_URL, CFE_PRUEBAS_TOKEN
 *   Ambiente PRODUCCION:
 *     CFE_PRODUCCION_URL, CFE_PRODUCCION_TOKEN
 */

import { buildCFE } from './cfeBuilder.js';

/**
 * Construye la configuración de envío CFE según el ambiente de la empresa.
 * Retorna null si CFE_HABILITADO !== 'true' o si faltan credenciales.
 * @param {{ cfe_ambiente?: string }} empresa
 * @returns {{ url: string, token: string, timeoutMs: number } | null}
 */
export function buildCfeConfig(empresa) {
  if (process.env.CFE_HABILITADO !== 'true') return null;
  const ambiente = (empresa?.cfe_ambiente || 'LOCAL').toUpperCase();
  const parsedTimeout = parseInt(process.env.CFE_TIMEOUT_MS, 10);
  const timeoutMs = Math.max(1000, Number.isFinite(parsedTimeout) ? parsedTimeout : 20000);

  let url, token;
  if (ambiente === 'PRODUCCION') {
    url   = process.env.CFE_PRODUCCION_URL;
    token = process.env.CFE_PRODUCCION_TOKEN;
  } else if (ambiente === 'PRUEBAS') {
    url   = process.env.CFE_PRUEBAS_URL;
    token = process.env.CFE_PRUEBAS_TOKEN;
  } else {
    // LOCAL — usa las vars legacy CFE_API_URL / CFE_API_TOKEN
    url   = process.env.CFE_API_URL;
    token = process.env.CFE_API_TOKEN;
  }

  if (!url || !token) return null;
  return { url, token, timeoutMs };
}

/**
 * Envía el CFE de la venta al endpoint configurado.
 * @param {number} ventaId
 * @param {{ url: string, token: string, timeoutMs: number } | null} [config]
 *   Si no se pasa, lee las variables de entorno legacy (CFE_API_URL / CFE_API_TOKEN).
 */
export async function sendCFE(ventaId, config = null) {
  const apiUrl    = config?.url   ?? process.env.CFE_API_URL;
  const apiToken  = config?.token ?? process.env.CFE_API_TOKEN;
  const timeoutMs = config?.timeoutMs ?? parseInt(process.env.CFE_TIMEOUT_MS || '20000', 10);

  if (!apiUrl || !apiToken) {
    throw new Error('El envío de CFE no está configurado para este ambiente.');
  }

  let payload;
  try {
    payload = await buildCFE(ventaId);
  } catch (err) {
    throw new Error(`Error construyendo CFE para venta ${ventaId}: ${err.message}`);
  }

  // Modo dry-run: loguear el JSON pero NO enviar a Dynamica.
  // Activar con CFE_DRY_RUN=true en el .env.
  if (process.env.CFE_DRY_RUN === 'true') {
    console.log(`[CFE DRY-RUN] Venta #${ventaId} — payload NO enviado a Dynamica:`);
    console.log(JSON.stringify(payload, null, 2));
    return {
      CFE: {
        CFEStatus: '1',
        CFEMsgCod: '100',
        CFEMsgDsc: '[DRY-RUN] CFE simulado — no enviado a Dynamica',
      },
    };
  }

  console.log(`[CFE] Enviando venta #${ventaId} → ${apiUrl}`);
  console.log(`[CFE] Payload:`, JSON.stringify(payload, null, 2));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Timeout enviando CFE: la API no respondió en ${timeoutMs / 1000}s`);
    }
    throw new Error(`Error de red enviando CFE: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  console.log(`[CFE] Respuesta HTTP ${response.status} para venta #${ventaId}`);

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error(`[CFE] Error de la API:`, errorText);
    throw new Error(`Error al enviar CFE (HTTP ${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log(`[CFE] Resultado:`, JSON.stringify(result, null, 2));

  // Respuesta vacía (array vacío) = el payload no llegó al ambiente
  if (Array.isArray(result) && result.length === 0) {
    throw new Error('CFE no llegó al ambiente: la API devolvió una respuesta vacía. Verificar URL y token del ambiente configurado.');
  }

  // Validar resultado lógico del CFE.
  // Dynamica usa CFEStatus=3 para rechazos. Erros.ErrosItem puede contener
  // tanto mensajes informativos de éxito (ej. código 100) como errores reales,
  // por lo que NO se usa como indicador de rechazo — solo CFEStatus=3.
  const cfeData = result?.CFE;
  if (cfeData && cfeData.CFEStatus === '3') {
    const msgBase = cfeData.CFEMsgDsc || `CFE rechazado (estado ${cfeData.CFEStatus})`;
    const errItems = cfeData.Erros?.ErrosItem;
    const errores = Array.isArray(errItems) ? errItems : (errItems ? [errItems] : []);
    // Deduplicar errores por código+descripción
    const vistos = new Set();
    const lineas = errores
      .filter((e) => {
        const key = `${e.CFEErrCod}:${e.CFEErrDesc}`;
        if (vistos.has(key)) return false;
        vistos.add(key);
        return true;
      })
      .map((e) => `[${e.CFEErrCod}] ${e.CFEErrDesc}`);

    const mensaje = lineas.length
      ? `${msgBase}\n\n${lineas.join('\n')}`
      : msgBase;

    const err = new Error(mensaje);
    err.cfeResult = result;
    throw err;
  }

  return result;
}
