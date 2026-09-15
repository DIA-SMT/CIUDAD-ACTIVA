// Rutas de autenticacion: ingreso, salida, sesion en curso y cambio de
// contrasena. Se monta en /api/auth desde server.js.
//
// adjuntarUsuario se aplica de forma global en server.js; aca solo se usa
// requiereSesion en las rutas que el contrato marca como privadas.

import { Router } from 'express';

import { consultarUna, ejecutar, enTransaccion } from '../db/index.js';
import { ahora } from '../lib/fechas.js';
import { hashPassword, validarPassword, verificarPassword } from '../lib/passwords.js';
import { crearSesion, destruirSesion, requiereSesion } from '../middleware/auth.js';
import { asyncH, ErrorHttp } from '../middleware/errores.js';

const router = Router();

// ---------------------------------------------------------------------------
// Limite de intentos de ingreso
//
// Un Map en memoria del proceso alcanza para una instalacion de una sola
// instancia como esta y evita sumar una tabla o un servicio externo. Las
// entradas vencidas se barren cada tanto para que el Map no crezca sin techo.
// ---------------------------------------------------------------------------

const MAX_INTENTOS = 8;
const VENTANA_MS = 15 * 60 * 1000;
const LIMPIEZA_CADA_MS = 60 * 1000;
const MAX_CLAVES = 5000;

const intentos = new Map(); // identificador en minusculas -> { fallos, hasta }
let ultimaLimpieza = 0;

function limpiarIntentos(ms) {
  if (ms - ultimaLimpieza < LIMPIEZA_CADA_MS && intentos.size < MAX_CLAVES) return;
  ultimaLimpieza = ms;

  for (const [clave, dato] of intentos) {
    if (dato.hasta <= ms) intentos.delete(clave);
  }

  // Ante una avalancha de identificadores distintos se prefiere perder los
  // contadores antes que la memoria del proceso.
  if (intentos.size >= MAX_CLAVES) intentos.clear();
}

/** Milisegundos que faltan para poder reintentar. 0 = no esta bloqueado. */
function esperaRestante(clave, ms) {
  const dato = intentos.get(clave);
  if (!dato || dato.fallos < MAX_INTENTOS || dato.hasta <= ms) return 0;
  return dato.hasta - ms;
}

function registrarFallo(clave, ms) {
  let dato = intentos.get(clave);
  // Vencida la ventana, el conteo vuelve a arrancar de cero.
  if (!dato || dato.hasta <= ms) dato = { fallos: 0, hasta: ms + VENTANA_MS };

  dato.fallos += 1;
  // Los 15 minutos de bloqueo se cuentan desde el intento que lo dispara.
  if (dato.fallos >= MAX_INTENTOS) dato.hasta = ms + VENTANA_MS;

  intentos.set(clave, dato);
}

function olvidarIntentos(...claves) {
  for (const clave of claves) if (clave) intentos.delete(clave);
}

let hashSenuelo = null;

// Cuando el usuario no existe igual se calcula un hash descartable: sin esto la
// respuesta volveria mucho mas rapido que con una cuenta real y esa diferencia
// de tiempo alcanzaria para averiguar que usuarios estan dados de alta.
function verificacionSenuelo(password) {
  hashSenuelo ??= hashPassword('senuelo-sin-uso');
  verificarPassword(password, hashSenuelo);
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Proyecta una fila de usuarios al tipo Perfil del contrato. Nunca el hash. */
function perfil(u) {
  return {
    id: u.id,
    nombre: u.nombre,
    cargo: u.cargo,
    email: u.email,
    usuario: u.usuario,
    rol: u.rol,
    dicta_clases: Number(u.dicta_clases),
    debe_cambiar_password: Number(u.debe_cambiar_password),
  };
}

/** Id de la sesion en curso, tal como lo deja adjuntarUsuario en la request. */
function idSesionActual(req) {
  return req.sesion?.id ?? req.sesionId ?? null;
}

const minutosLegibles = (ms) => {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return `${m} ${m === 1 ? 'minuto' : 'minutos'}`;
};

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

router.post('/login', asyncH(async (req, res) => {
  const identificador = String(req.body?.usuario ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!identificador || !password) {
    throw new ErrorHttp(400, 'Ingresa tu usuario y tu contraseña.');
  }

  const clave = identificador.toLowerCase();
  const ms = Date.now();
  limpiarIntentos(ms);

  const espera = esperaRestante(clave, ms);
  if (espera > 0) {
    res.set('Retry-After', String(Math.ceil(espera / 1000)));
    throw new ErrorHttp(429,
      `Demasiados intentos fallidos. Vuelve a probar en ${minutosLegibles(espera)}.`);
  }

  // El contrato acepta nombre de usuario o correo. Se comparan en minusculas
  // porque SQLite distingue mayusculas y nadie escribe siempre igual su mail.
  const u = consultarUna(
    `SELECT id, nombre, cargo, email, usuario, password_hash, rol,
            dicta_clases, activo, debe_cambiar_password
       FROM usuarios
      WHERE lower(usuario) = ? OR lower(email) = ?
      LIMIT 1`,
    [clave, clave],
  );

  const valida = u ? verificarPassword(password, u.password_hash) : verificacionSenuelo(password);

  // Mismo mensaje para cuenta inexistente y para contrasena equivocada: si
  // fueran distintos, el formulario serviria para listar usuarios validos.
  if (!valida) {
    registrarFallo(clave, ms);
    throw new ErrorHttp(401, 'Usuario o contraseña incorrectos.');
  }

  // Recien con la contrasena correcta se informa que la cuenta esta dada de
  // baja; avisarlo antes seria otra manera de confirmar que existe.
  if (!u.activo) {
    throw new ErrorHttp(403,
      'Tu usuario está inactivo. Contacta al administrador del sistema para que lo habilite.');
  }

  // Un ingreso exitoso borra el conteo, tanto del texto tecleado como de las
  // otras dos formas de nombrar a esta misma persona.
  olvidarIntentos(clave, String(u.usuario).toLowerCase(), String(u.email).toLowerCase());

  ejecutar('UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?', [ahora(), u.id]);
  crearSesion(u.id, req, res);

  res.json({ usuario: perfil(u) });
}));

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

router.post('/logout', requiereSesion, asyncH(async (req, res) => {
  destruirSesion(req, res);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// GET /api/auth/sesion
// ---------------------------------------------------------------------------

router.get('/sesion', asyncH(async (req, res) => {
  // Sin guardia: es la ruta que el frontend consulta justamente para saber si
  // hay sesion, y un 401 aca es una respuesta esperada, no una falla.
  if (!req.usuario) throw new ErrorHttp(401, 'No hay una sesión activa.');
  res.json({ usuario: perfil(req.usuario) });
}));

// ---------------------------------------------------------------------------
// POST /api/auth/password
// ---------------------------------------------------------------------------

router.post('/password', requiereSesion, asyncH(async (req, res) => {
  const actual = String(req.body?.actual ?? '');
  const nueva = String(req.body?.nueva ?? '');

  const fila = consultarUna('SELECT id, password_hash FROM usuarios WHERE id = ?', [req.usuario.id]);
  if (!fila) throw new ErrorHttp(401, 'Tu sesión ya no es válida. Vuelve a ingresar.');

  if (!actual) {
    throw new ErrorHttp(422, 'Revisa los datos ingresados.',
      { actual: 'Ingresa tu contraseña actual.' });
  }
  if (!verificarPassword(actual, fila.password_hash)) {
    throw new ErrorHttp(422, 'Revisa los datos ingresados.',
      { actual: 'La contraseña actual no es correcta.' });
  }

  const fallas = validarPassword(nueva);
  if (fallas.length) {
    throw new ErrorHttp(422, 'La nueva contraseña no cumple los requisitos.',
      { nueva: fallas.join(' ') });
  }
  // actual ya quedo verificada, asi que comparar los textos alcanza.
  if (nueva === actual) {
    throw new ErrorHttp(422, 'La nueva contraseña no cumple los requisitos.',
      { nueva: 'La nueva contraseña tiene que ser distinta de la actual.' });
  }

  const hash = hashPassword(nueva);
  const idActual = idSesionActual(req);

  enTransaccion(() => {
    ejecutar(
      `UPDATE usuarios
          SET password_hash = ?, debe_cambiar_password = 0, actualizado_en = ?
        WHERE id = ?`,
      [hash, ahora(), fila.id],
    );

    // Cambiar la contrasena cierra lo que haya quedado abierto en otros
    // equipos; la sesion desde la que se hace el cambio sigue viva.
    if (idActual) {
      ejecutar('DELETE FROM sesiones WHERE usuario_id = ? AND id <> ?', [fila.id, idActual]);
    } else {
      ejecutar('DELETE FROM sesiones WHERE usuario_id = ?', [fila.id]);
    }
  });

  // Si no se pudo identificar la sesion en curso se cerraron todas, de modo que
  // se emite una nueva cookie para no dejar al usuario afuera tras el cambio.
  if (!idActual) crearSesion(req.usuario.id, req, res);

  res.json({ ok: true });
}));

export default router;
