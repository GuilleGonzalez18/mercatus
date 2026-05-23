import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Carga .env (dev local). En producción no existe, no falla.
dotenv.config();

const companyName = process.env.COMPANY_NAME;
if (companyName) {
  const propsPath = join(__dirname, '../../props', `prop-${companyName}.properties`);
  try {
    const raw = readFileSync(propsPath, 'utf8');
    let loaded = 0;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      // Las env vars explícitas (ej: dashboard de Render) tienen precedencia
      if (key && !(key in process.env)) {
        process.env[key] = value;
        loaded++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[config] ${loaded} propiedades cargadas desde prop-${companyName}.properties`);
    console.log('[debug] CLOUDINARY_URL:', process.env.CLOUDINARY_URL ? 'definida' : 'undefined');
  } catch (e) {
    if (e.code === 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn(`[config] No se encontró props/prop-${companyName}.properties – usando solo variables de entorno.`);
    } else {
      throw e;
    }
  }
}
