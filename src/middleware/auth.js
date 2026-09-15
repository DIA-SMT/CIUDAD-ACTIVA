// Sesiones y permisos.
//
// El identificador de sesion es un token opaco de 256 bits (nuevoToken) que
// vive en la tabla `sesiones` con su vencimiento. Por eso la cookie NO se
// firma: una firma con config.sesion.secreto no agregaria seguridad sobre un
// valor aleatorio que ademas se verifica contra la base en cada pedido, y si
// agregaria un esquema propio a medias. La cookie es httpOnly, sameSite=Lax y
// secure en produccion; el valor, opaco.

import { config } from '../config.js';
import { consultarUna, ejecutar } from '../db/index.js';
import { ahora, ahoraMasHoras } from '../lib/fechas.js';
import { nuevoToken } from '../lib/passwords.js';
import { ErrorHttp } from './errores.js';

// Campos del Perfil del contrato. password_hash no se selecciona nunca.
const SQL_PERFIL = `
  SELECT id, nombre, cargo, email, usuario, rol, dicta_clases, debe_cambiar_password
    FROM usuarios
   WHERE id = ? AND activo = 1`;

// Forma esperada del token. Descarta cookies basura sin tocar la base.
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{16,128}$/;

const SEGUNDOS_SESION = Math.max(60, Math.round(config.sesion.horas * 3600));

/**
 * Parser propio de cookies (el proyecto no usa cookie-parser).
 * Devuelve un objeto sin prototipo: asi un nombre de cookie como '__proto__'
 * no puede ensuciar Object.prototype.
 */
export function leerCookies(req) {
  if (req && req.cookiesLeidas) return req.cookiesLeidas;

  const cookies = Object.create(null);
  const crudo = req?.headers?.cookie;

  if (typeof crudo === 'string' && crudo !== '') {
    for (const parte of crudo.split(';')) {
      const corte = parte.indexOf('=');
      if (corte < 1) continue;

      const nombre = parte.slice(0, corte).trim();
      if (!nombre) continue;

      let valor = parte.slice(corte + 1).trim();
      if (valor.length >= 2 && valor.startsWith('"') && valor.endsWith('"')) {
        valor = valor.slice(1, -1);
      }
      try {
        valor = decodeURIComponent(valor);
      } catch {
        // Valor con un % mal formado: se deja tal cual, no vale tirar el pedido.
      }

      if (!(nombre in cookies)) cookies[nombre] = valor; // gana la primera
    }
  }

  if (req) req.cookiesLeidas = cookies;
  return cookies;
}

function armarCookie(valor, segundos) {
  const partes = [
    `${config.sesion.cookie}=${valor}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${segundos}`,
  ];
  // Sin HTTPS el navegador descartaria la cookie, y en la intranet municipal
  // el sistema puede correr en HTTP plano.
  if (config.produccion) partes.push('Secure');
  return partes.join('; ');
}

function vencerCookie(res) {
  if (!res || typeof res.setHeader !== 'function' || res.headersSent) return;
  res.setHeader('Set-Cookie',
    `${armarCookie('', 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

function ipDe(req) {
  const ip = req?.ip || req?.socket?.remoteAddress || '';
  return String(ip).slice(0, 64);
}

// Barrido oportunista: no hay tarea programada, asi que la tabla se limpia
// sola cada tanto mientras la gente usa el sistema.
const INTERVALO_BARRIDO_MS = 3600_000;
let ultimoBarrido = 0;

function barridoOportuno() {
  const ahoraMs = Date.now();
  if (ahoraMs - ultimoBarrido < INTERVALO_BARRIDO_MS) return;
  ultimoBarrido = ahoraMs;
  try {
    limpiarSesionesVencidas();
  } catch {
    // Limpiar es mantenimiento: si falla, el pedido en curso sigue igual.
  }
}

/**
 * Deja en req.usuario el Perfil del usuario de la sesion (o null) y en
 * req.sesionId el identificador. Nunca corta la cadena: quien exija sesion es
 * requiereSesion / requiereAdmin.
 */
export function adjuntarUsuario(req, res, next) {
  req.usuario = null;
  req.sesionId = null;

  try {
    const id = leerCookies(req)[config.sesion.cookie];
    if (!id || !TOKEN_VALIDO.test(id)) return next();

    const sesion = consultarUna(
      'SELECT id, usuario_id, expira_en FROM sesiones WHERE id = ?', [id]);

    if (!sesion) {
      vencerCookie(res);
      return next();
    }

    if (String(sesion.expira_en) <= ahora()) {
      ejecutar('DELETE FROM sesiones WHERE id = ?', [sesion.id]);
      barridoOportuno();
      vencerCookie(res);
      return next();
    }

    const usuario = consultarUna(SQL_PERFIL, [sesion.usuario_id]);
    if (!usuario) {
      // Usuario dado de baja: sus sesiones dejan de valer en el acto.
      ejecutar('DELETE FROM sesiones WHERE usuario_id = ?', [sesion.usuario_id]);
      vencerCookie(res);
      return next();
    }

    req.usuario = usuario;
    req.sesionId = sesion.id;
    barridoOportuno();
    return next();
  } catch (error) {
    return next(error);
  }
}

/** Corta con 401 si no hay sesion vigente. */
export function requiereSesion(req, res, next) {
  if (!req.usuario) {
    return next(new ErrorHttp(401, 'Tu sesión expiró o todavía no ingresaste. Vuelve a ingresar.'));
  }
  return next();
}

/** Corta con 401 sin sesion y con 403 si el rol no es admin. */
export function requiereAdmin(req, res, next) {
  if (!req.usuario) {
    return next(new ErrorHttp(401, 'Tu sesión expiró o todavía no ingresaste. Vuelve a ingresar.'));
  }
  if (req.usuario.rol !== 'admin') {
    return next(new ErrorHttp(403, 'Esta sección es sólo para administradores.'));
  }
  return next();
}

/**
 * Crea la sesion, guarda la fila y manda la cookie. Devuelve el id de sesion.
 * Se guardan ip y user agent para poder auditar un ingreso dudoso.
 */
export function crearSesion(usuarioId, req, res) {
  const id = nuevoToken();
  const creada = ahora();
  const expira = ahoraMasHoras(config.sesion.horas);
  const agente = String(req?.headers?.['user-agent'] ?? '').slice(0, 300);

  ejecutar(
    `INSERT INTO sesiones (id, usuario_id, creada_en, expira_en, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, Number(usuarioId), creada, expira, ipDe(req), agente],
  );

  // Max-Age acompana al vencimiento guardado: la cookie muere cuando la fila.
  res.setHeader('Set-Cookie', armarCookie(id, SEGUNDOS_SESION));

  if (req) req.sesionId = id;
  return id;
}

/** Cierra la sesion en curso: borra la fila y vence la cookie. */
export function destruirSesion(req, res) {
  const id = req?.sesionId || leerCookies(req)[config.sesion.cookie] || null;

  if (id && TOKEN_VALIDO.test(id)) {
    ejecutar('DELETE FROM sesiones WHERE id = ?', [id]);
  }

  if (req) {
    req.usuario = null;
    req.sesionId = null;
  }
  vencerCookie(res);

  return Boolean(id);
}

/** Borra las sesiones vencidas. Devuelve cuantas filas saco. */
export function limpiarSesionesVencidas() {
  const resultado = ejecutar('DELETE FROM sesiones WHERE expira_en <= ?', [ahora()]);
  return Number(resultado?.changes ?? 0);
}
