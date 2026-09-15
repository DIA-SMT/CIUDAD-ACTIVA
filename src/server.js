// Punto de entrada del sistema Ciudad Activa.
//
//   npm start     levanta el servidor
//   npm run dev   idem, recargando ante cambios
//
// Arma la aplicacion Express, monta la API bajo /api, sirve las tres pantallas
// estaticas de public/ y cierra la base de forma ordenada al recibir una senal.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { config, RAIZ } from './config.js';
import { conectar, cerrar, consultarUna } from './db/index.js';

import { adjuntarUsuario } from './middleware/auth.js';
import { ErrorHttp, noEncontrado, manejadorErrores } from './middleware/errores.js';

import rutasAuth from './routes/auth.routes.js';
import rutasCatalogos from './routes/catalogos.routes.js';
import rutasRegistros from './routes/registros.routes.js';
import rutasEstadisticas from './routes/estadisticas.routes.js';
import rutasAdmin from './routes/admin.routes.js';

// Se lee el package.json en vez de importarlo: los modulos JSON siguen siendo
// experimentales y ensucian la salida con un warning en cada arranque.
const paquete = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
export const VERSION = paquete.version ?? '0.0.0';

// Sin helmet (no es dependencia del proyecto): las cabeceras van a mano.
// 'unsafe-inline' en estilos es necesario porque las pantallas y Chart.js
// aplican estilos en linea; los scripts siguen limitados a 'self' y al CDN.
const POLITICA_CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

function cabecerasSeguridad(req, res, siguiente) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', POLITICA_CSP);
  siguiente();
}

/** Cantidad de registros cargados. Se usa en /api/salud y en el cartel de inicio. */
function contarRegistros() {
  return consultarUna('SELECT COUNT(*) AS n FROM registros')?.n ?? 0;
}

/** Arma la aplicacion Express con todo montado, sin ponerla a escuchar. */
export function crearApp() {
  const app = express();

  app.disable('x-powered-by');
  // Detras del proxy del municipio, para que la IP que guarda la sesion sea la real.
  app.set('trust proxy', 'loopback');

  app.use(cabecerasSeguridad);
  app.use(express.json({ limit: '256kb' }));

  // Resuelve la cookie de sesion antes de cualquier ruta: las que piden permisos
  // ya encuentran req.usuario listo, y las publicas simplemente lo ignoran.
  app.use(adjuntarUsuario);

  // Monitoreo: no requiere sesion, para poder chequear el servicio desde afuera.
  app.get('/api/salud', (req, res) => {
    res.json({ ok: true, version: VERSION, registros: contarRegistros() });
  });

  app.use('/api/auth', rutasAuth);
  app.use('/api/catalogos', rutasCatalogos);
  app.use('/api/registros', rutasRegistros);
  app.use('/api/estadisticas', rutasEstadisticas);
  app.use('/api/admin', rutasAdmin);

  // La raiz es la pantalla de ingreso.
  app.get('/', (req, res, siguiente) => {
    res.sendFile(path.join(config.rutaPublica, 'index.html'), (error) => {
      // El error de sendFile trae la ruta del disco en el mensaje, asi que no
      // se reenvia tal cual: el usuario ve un texto limpio.
      if (error && !res.headersSent) {
        siguiente(new ErrorHttp(500,
          'No se pudo abrir la pantalla de ingreso. Revisa la instalación del sistema.'));
      }
    });
  });

  app.use(express.static(config.rutaPublica, {
    index: 'index.html',
    extensions: ['html'],       // /carga sirve carga.html
    maxAge: config.produccion ? '1h' : 0,
  }));

  app.use(noEncontrado);
  app.use(manejadorErrores);

  return app;
}

/**
 * Abre la base y verifica que este sembrada. Sin usuarios no hay forma de
 * ingresar al sistema, asi que conviene cortar aca con un mensaje claro
 * antes que dejar al usuario frente a un login que nunca va a funcionar.
 */
function prepararBase() {
  conectar();
  const usuarios = consultarUna('SELECT COUNT(*) AS n FROM usuarios')?.n ?? 0;

  if (usuarios === 0) {
    console.error('\nLa base de datos no tiene ningun usuario cargado.');
    console.error(`Base: ${config.rutaDB}`);
    console.error('\nAntes de levantar el servidor corre la carga inicial:\n');
    console.error('    npm run init-db\n');
    cerrar();
    process.exit(1);
  }
}

function iniciar() {
  prepararBase();

  const app = crearApp();
  const servidor = app.listen(config.puerto, () => {
    // En Windows este callback tambien corre cuando el puerto estaba ocupado;
    // recien address() distingue el arranque real del fallido.
    const direccion = servidor.address();
    if (!direccion) return;

    console.log('');
    console.log(`  Ciudad Activa v${VERSION} - Direccion de Deportes y Recreacion`);
    console.log(`  Servidor:  http://localhost:${direccion.port}`);
    console.log(`  Base:      ${config.rutaDB}`);
    console.log(`  Registros: ${contarRegistros()}`);
    console.log('');
  });

  servidor.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\nEl puerto ${config.puerto} ya esta en uso.`);
      console.error('Cerra el otro proceso o cambia PORT en el archivo .env.\n');
    } else {
      console.error(`\nNo se pudo iniciar el servidor: ${error.message}\n`);
    }
    cerrar();
    process.exit(1);
  });

  let cerrando = false;
  const apagar = (senal) => {
    if (cerrando) return;
    cerrando = true;
    console.log(`\nSenal ${senal} recibida, cerrando Ciudad Activa...`);

    servidor.close(() => {
      cerrar();
      process.exit(0);
    });
    servidor.closeIdleConnections?.();

    // Si alguna conexion queda colgada no se espera indefinidamente.
    setTimeout(() => {
      cerrar();
      process.exit(0);
    }, 5000).unref();
  };

  process.on('SIGINT', () => apagar('SIGINT'));
  process.on('SIGTERM', () => apagar('SIGTERM'));

  return servidor;
}

// Solo arranca si se ejecuta este archivo; importarlo (por ejemplo desde un
// test que quiera usar crearApp) no levanta ningun puerto.
const ejecutadoDirecto = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (ejecutadoDirecto) iniciar();

export default crearApp;
