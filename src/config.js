import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(aqui, '..');

// Node >= 20.12 permite cargar el .env sin dependencias externas.
try {
  process.loadEnvFile(path.join(RAIZ, '.env'));
} catch {
  // Sin archivo .env se usan los valores por defecto de abajo.
}

const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export const config = {
  puerto: num(process.env.PORT, 3000),
  rutaDB: path.resolve(RAIZ, process.env.DB_PATH || './data/ciudad-activa.db'),
  rutaPublica: path.join(RAIZ, 'public'),

  sesion: {
    secreto: process.env.SESSION_SECRET || 'cambiar-esta-clave-en-produccion',
    horas: num(process.env.SESSION_HORAS, 12),
    cookie: 'ca_sesion',
  },

  // Password inicial de los usuarios sembrados desde el Excel.
  passwordSemilla: process.env.SEED_PASSWORD || 'ciudadactiva2026',

  // REQ 6: permisos de modificacion.
  // Un profesor puede editar sus propios registros dentro de esta ventana.
  // El administrador no tiene limite. Los profesores no pueden eliminar.
  ventanaEdicionProfesorDias: num(process.env.VENTANA_EDICION_DIAS, 7),

  produccion: process.env.NODE_ENV === 'production',
};

export default config;
