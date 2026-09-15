// /api/admin — gestion de usuarios y de lugares, reset de contrasena y
// auditoria global. Todo el router exige rol admin.
//
// Regla de fondo: aca no se borra nada. Un profesor o un lugar que ya tiene
// clases cargadas se desactiva (activo = 0), nunca se elimina: deja de
// ofrecerse en el formulario (REQ 2 y REQ 3) pero el historico del REQ 5
// queda intacto y las estadisticas del REQ 7 siguen cuadrando.

import { Router } from 'express';
import { consultar, consultarUna, ejecutar, enTransaccion } from '../db/index.js';
import { requiereAdmin } from '../middleware/auth.js';
import { asyncH, ErrorHttp } from '../middleware/errores.js';
import { hashPassword, validarPassword } from '../lib/passwords.js';
import { ahora, esFechaISO } from '../lib/fechas.js';
import { ETIQUETAS_CAMPOS } from '../lib/validacion.js';

const router = Router();

router.use(requiereAdmin);

// ---------------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------------

const POR_PAGINA_DEF = 25;
const POR_PAGINA_MAX = 200;

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_USUARIO = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const ROLES = ['profesor', 'admin'];

const LARGOS = { nombre: 120, cargo: 80, email: 160, descripcion: 400 };
const ORDEN_MAX = 9999;

// Unico lugar donde se construye el error: si cambia la firma de ErrorHttp,
// se ajusta aca y no en los veinte usos.
const fallo = (estado, mensaje, errores) => new ErrorHttp(estado, mensaje, errores);

const texto = (v) => String(v ?? '').trim();

/** Normaliza un 0/1 aceptando booleanos, numeros y texto del formulario. */
function bandera(valor, porDefecto) {
  if (valor === undefined || valor === null || valor === '') return porDefecto;
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  const s = String(valor).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'si') return 1;
  if (s === '0' || s === 'false' || s === 'no') return 0;
  return porDefecto;
}

/** Entero de una query o del cuerpo; null si no lo es. */
function entero(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function idDeRuta(req) {
  const n = entero(req.params.id);
  if (n === null || n <= 0) throw fallo(400, 'El identificador indicado no es válido.');
  return n;
}

/** Perfil del admin que hace el pedido; lo deja el middleware de sesion. */
const quienPide = (req) => req.usuario ?? {};

function lanzarSiHayErrores(errores, mensaje) {
  if (Object.keys(errores).length > 0) throw fallo(422, mensaje, errores);
}

/** REQ 5: la baja no borra nada, asi que se avisa cuanto historico queda atado. */
function avisoBaja(tipo, cantidad) {
  const que = tipo === 'usuario'
    ? 'El usuario quedó desactivado: ya no puede ingresar ni aparece en el listado de profesores autorizados.'
    : 'El lugar quedó desactivado: ya no se ofrece en el formulario de carga.';
  const quedan = cantidad === 1
    ? 'Queda 1 registro asociado, que se conserva en el histórico.'
    : `Quedan ${cantidad} registros asociados, que se conservan en el histórico.`;
  return `${que} ${quedan}`;
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

// password_hash no se selecciona nunca: no puede escaparse por descuido.
const SQL_USUARIO = `
  SELECT u.id, u.nombre, u.cargo, u.email, u.usuario, u.rol,
         u.dicta_clases, u.activo, u.debe_cambiar_password,
         u.creado_en, u.actualizado_en, u.ultimo_acceso,
         (SELECT COUNT(*) FROM registros r WHERE r.profesor_id = u.id) AS registros,
         (SELECT MAX(r.fecha) FROM registros r WHERE r.profesor_id = u.id) AS ultima_clase
    FROM usuarios u`;

const leerUsuario = (id) => consultarUna(`${SQL_USUARIO} WHERE u.id = ?`, [id]);

/** Cantidad de administradores activos sin contar a uno dado. */
function adminsActivosSalvo(id) {
  return consultarUna(
    `SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?`,
    [id],
  ).n;
}

/**
 * Normaliza el cuerpo de un usuario. Con `actual` presente es una edicion:
 * los campos que no vienen conservan su valor.
 */
function armarUsuario(cuerpo, actual) {
  const errores = {};

  const nombre = texto(cuerpo.nombre ?? actual?.nombre);
  if (nombre.length < 2) errores.nombre = 'Escribe el nombre y apellido del usuario.';
  else if (nombre.length > LARGOS.nombre) errores.nombre = `El nombre no puede superar los ${LARGOS.nombre} caracteres.`;

  const cargo = texto(cuerpo.cargo ?? actual?.cargo) || 'Profesor';
  if (cargo.length > LARGOS.cargo) errores.cargo = `El cargo no puede superar los ${LARGOS.cargo} caracteres.`;

  const email = texto(cuerpo.email ?? actual?.email).toLowerCase();
  if (!email) errores.email = 'Indica el correo electrónico.';
  else if (email.length > LARGOS.email) errores.email = `El correo no puede superar los ${LARGOS.email} caracteres.`;
  else if (!RE_EMAIL.test(email)) errores.email = 'El correo electrónico no tiene un formato válido.';

  const usuario = texto(cuerpo.usuario ?? actual?.usuario).toLowerCase();
  if (!usuario) errores.usuario = 'Indica el nombre de usuario con el que va a ingresar.';
  else if (!RE_USUARIO.test(usuario)) {
    errores.usuario = 'El usuario debe tener entre 3 y 40 caracteres y solo letras, números, punto, guión o guión bajo.';
  }

  const rol = texto(cuerpo.rol ?? actual?.rol ?? 'profesor').toLowerCase();
  if (!ROLES.includes(rol)) errores.rol = 'El rol debe ser «profesor» o «admin».';

  return {
    errores,
    datos: {
      nombre,
      cargo,
      email,
      usuario,
      rol,
      dicta_clases: bandera(cuerpo.dicta_clases, actual ? actual.dicta_clases : 1),
      activo: bandera(cuerpo.activo, actual ? actual.activo : 1),
    },
  };
}

/** REQ 2: email y usuario son la identidad de la cuenta, no pueden repetirse. */
function verificarUnicidadUsuario(email, usuario, excluirId = 0) {
  const porEmail = consultarUna(
    'SELECT id, nombre, usuario, activo FROM usuarios WHERE lower(email) = ? AND id <> ?',
    [email, excluirId],
  );
  const porUsuario = consultarUna(
    'SELECT id, nombre, email, activo FROM usuarios WHERE lower(usuario) = ? AND id <> ?',
    [usuario, excluirId],
  );

  if (porEmail && porUsuario) {
    throw fallo(409,
      `El correo «${email}» y el nombre de usuario «${usuario}» ya están usados por otras cuentas. Cambia los dos.`);
  }
  if (porEmail) {
    const extra = porEmail.activo === 0
      ? ' Esa cuenta está desactivada: puedes reactivarla en lugar de crear otra.'
      : '';
    throw fallo(409, `El correo «${email}» ya está registrado en la cuenta de ${porEmail.nombre}.${extra}`);
  }
  if (porUsuario) {
    const extra = porUsuario.activo === 0
      ? ' Esa cuenta está desactivada: puedes reactivarla en lugar de crear otra.'
      : '';
    throw fallo(409, `El nombre de usuario «${usuario}» ya lo usa ${porUsuario.nombre}. Elige otro.${extra}`);
  }
}

// Todos, incluidos los inactivos: el panel necesita poder reactivarlos.
router.get('/usuarios', asyncH((req, res) => {
  const usuarios = consultar(`${SQL_USUARIO} ORDER BY u.activo DESC, u.nombre COLLATE NOCASE`);
  res.json({ usuarios });
}));

router.post('/usuarios', asyncH((req, res) => {
  const cuerpo = req.body ?? {};
  const { errores, datos } = armarUsuario(cuerpo, null);

  // La contrasena inicial pasa por las mismas reglas que un cambio propio.
  const password = String(cuerpo.password ?? '');
  const problemas = validarPassword(password);
  if (problemas.length > 0) errores.password = problemas.join(' ');

  lanzarSiHayErrores(errores, 'Revisa los datos del usuario.');
  verificarUnicidadUsuario(datos.email, datos.usuario);

  const t = ahora();
  // debe_cambiar_password = 1: la clave que carga el admin es de un solo uso.
  const alta = ejecutar(
    `INSERT INTO usuarios (nombre, cargo, email, usuario, password_hash, rol,
                           dicta_clases, activo, debe_cambiar_password, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [datos.nombre, datos.cargo, datos.email, datos.usuario, hashPassword(password),
      datos.rol, datos.dicta_clases, datos.activo, t, t],
  );

  res.status(201).json({
    usuario: leerUsuario(Number(alta.lastInsertRowid)),
    mensaje: `Usuario creado. ${datos.nombre} ingresa con «${datos.usuario}» y debe cambiar la contraseña la primera vez.`,
  });
}));

router.put('/usuarios/:id', asyncH((req, res) => {
  const id = idDeRuta(req);
  const actual = leerUsuario(id);
  if (!actual) throw fallo(404, 'No encontramos el usuario que quieres editar.');

  const { errores, datos } = armarUsuario(req.body ?? {}, actual);
  lanzarSiHayErrores(errores, 'Revisa los datos del usuario.');
  verificarUnicidadUsuario(datos.email, datos.usuario, id);

  // --- resguardos de acceso -------------------------------------------------
  // Que nadie se deje afuera del sistema por accidente.
  const yo = quienPide(req);
  if (Number(yo.id) === id) {
    if (datos.activo === 0) {
      throw fallo(403, 'No puedes desactivar tu propia cuenta. Si hace falta, que lo haga otro administrador.');
    }
    if (actual.rol === 'admin' && datos.rol !== 'admin') {
      throw fallo(403, 'No puedes quitarte a ti mismo el rol de administrador. Que lo haga otro administrador.');
    }
  }

  const dejaDeAdministrar = actual.rol === 'admin' && actual.activo === 1
    && (datos.rol !== 'admin' || datos.activo === 0);
  if (dejaDeAdministrar && adminsActivosSalvo(id) === 0) {
    throw fallo(409,
      `${actual.nombre} es el único administrador activo. Designa otro administrador antes de hacer este cambio.`);
  }

  const seDesactiva = actual.activo === 1 && datos.activo === 0;
  const t = ahora();

  enTransaccion(() => {
    ejecutar(
      `UPDATE usuarios
          SET nombre = ?, cargo = ?, email = ?, usuario = ?, rol = ?,
              dicta_clases = ?, activo = ?, actualizado_en = ?
        WHERE id = ?`,
      [datos.nombre, datos.cargo, datos.email, datos.usuario, datos.rol,
        datos.dicta_clases, datos.activo, t, id],
    );
    // Si se lo dio de baja, las sesiones abiertas dejan de valer en el acto.
    if (seDesactiva) ejecutar('DELETE FROM sesiones WHERE usuario_id = ?', [id]);
  });

  const usuario = leerUsuario(id);
  res.json({
    usuario,
    registros_asociados: usuario.registros,
    // REQ 5: la baja nunca borra; se avisa cuanto historico queda colgando.
    aviso: seDesactiva && usuario.registros > 0 ? avisoBaja('usuario', usuario.registros) : null,
  });
}));

router.post('/usuarios/:id/password', asyncH((req, res) => {
  const id = idDeRuta(req);
  const usuario = leerUsuario(id);
  if (!usuario) throw fallo(404, 'No encontramos el usuario.');

  const nueva = String(req.body?.nueva ?? '');
  const problemas = validarPassword(nueva);
  if (problemas.length > 0) {
    throw fallo(422, 'La contraseña nueva no cumple los requisitos.', { nueva: problemas.join(' ') });
  }

  const yo = quienPide(req);
  const t = ahora();

  enTransaccion(() => {
    ejecutar(
      `UPDATE usuarios
          SET password_hash = ?, debe_cambiar_password = 1, actualizado_en = ?
        WHERE id = ?`,
      [hashPassword(nueva), t, id],
    );
    // Las sesiones abiertas con la clave anterior dejan de valer. Si el admin
    // se resetea a si mismo se respeta la sesion en curso, para no perder el
    // panel a mitad del trabajo, pero sus otros dispositivos igual se cierran.
    ejecutar(
      'DELETE FROM sesiones WHERE usuario_id = ? AND id <> ?',
      [id, Number(yo.id) === id ? String(req.sesionId ?? '') : ''],
    );
  });

  res.json({
    ok: true,
    usuario: leerUsuario(id),
    mensaje: `Contraseña actualizada. ${usuario.nombre} tendrá que cambiarla al ingresar.`,
  });
}));

// ---------------------------------------------------------------------------
// Lugares (REQ 3)
// ---------------------------------------------------------------------------

const SQL_LUGAR = `
  SELECT l.id, l.nombre, l.descripcion, l.activo, l.orden, l.creado_en, l.actualizado_en,
         (SELECT COUNT(*) FROM registros r WHERE r.lugar_id = l.id) AS registros,
         (SELECT MAX(r.fecha) FROM registros r WHERE r.lugar_id = l.id) AS ultima_clase
    FROM lugares l`;

const leerLugar = (id) => consultarUna(`${SQL_LUGAR} WHERE l.id = ?`, [id]);

function armarLugar(cuerpo, actual) {
  const errores = {};

  const nombre = texto(cuerpo.nombre ?? actual?.nombre);
  if (!nombre) errores.nombre = 'Indica el nombre del lugar.';
  else if (nombre.length > LARGOS.nombre) errores.nombre = `El nombre no puede superar los ${LARGOS.nombre} caracteres.`;

  const descripcion = texto(cuerpo.descripcion ?? actual?.descripcion);
  if (descripcion.length > LARGOS.descripcion) {
    errores.descripcion = `La descripción no puede superar los ${LARGOS.descripcion} caracteres.`;
  }

  let orden = entero(cuerpo.orden);
  if (cuerpo.orden !== undefined && cuerpo.orden !== null && cuerpo.orden !== '' && orden === null) {
    errores.orden = 'El orden debe ser un número entero.';
  } else if (orden !== null && (orden < 0 || orden > ORDEN_MAX)) {
    errores.orden = `El orden debe estar entre 0 y ${ORDEN_MAX}.`;
  }
  if (orden === null) {
    orden = actual ? actual.orden : consultarUna('SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM lugares').n;
  }

  return {
    errores,
    datos: { nombre, descripcion, orden, activo: bandera(cuerpo.activo, actual ? actual.activo : 1) },
  };
}

function verificarUnicidadLugar(nombre, excluirId = 0) {
  const otro = consultarUna(
    'SELECT id, nombre, activo FROM lugares WHERE lower(nombre) = ? AND id <> ?',
    [nombre.toLowerCase(), excluirId],
  );
  if (!otro) return;
  const extra = otro.activo === 0
    ? ' Ese lugar está desactivado: puedes volver a activarlo en lugar de crear otro.'
    : '';
  throw fallo(409, `Ya existe un lugar llamado «${otro.nombre}».${extra}`);
}

router.get('/lugares', asyncH((req, res) => {
  const lugares = consultar(`${SQL_LUGAR} ORDER BY l.activo DESC, l.orden, l.nombre COLLATE NOCASE`);
  res.json({ lugares });
}));

router.post('/lugares', asyncH((req, res) => {
  const { errores, datos } = armarLugar(req.body ?? {}, null);
  lanzarSiHayErrores(errores, 'Revisa los datos del lugar.');
  verificarUnicidadLugar(datos.nombre);

  const t = ahora();
  const alta = ejecutar(
    `INSERT INTO lugares (nombre, descripcion, activo, orden, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [datos.nombre, datos.descripcion, datos.activo, datos.orden, t, t],
  );

  res.status(201).json({ lugar: leerLugar(Number(alta.lastInsertRowid)) });
}));

router.put('/lugares/:id', asyncH((req, res) => {
  const id = idDeRuta(req);
  const actual = leerLugar(id);
  if (!actual) throw fallo(404, 'No encontramos el lugar que quieres editar.');

  const { errores, datos } = armarLugar(req.body ?? {}, actual);
  lanzarSiHayErrores(errores, 'Revisa los datos del lugar.');
  verificarUnicidadLugar(datos.nombre, id);

  const seDesactiva = actual.activo === 1 && datos.activo === 0;
  const t = ahora();

  ejecutar(
    `UPDATE lugares
        SET nombre = ?, descripcion = ?, activo = ?, orden = ?, actualizado_en = ?
      WHERE id = ?`,
    [datos.nombre, datos.descripcion, datos.activo, datos.orden, t, id],
  );

  const lugar = leerLugar(id);
  res.json({
    lugar,
    registros_asociados: lugar.registros,
    // Se permite la baja aunque tenga clases cargadas: el historico se conserva.
    aviso: seDesactiva && lugar.registros > 0 ? avisoBaja('lugar', lugar.registros) : null,
  });
}));

// ---------------------------------------------------------------------------
// REQ 6: auditoria global de modificaciones
// ---------------------------------------------------------------------------

const SQL_HISTORIAL = `
  SELECT h.id, h.registro_id, h.accion, h.campo,
         h.valor_anterior, h.valor_nuevo, h.usuario_id,
         COALESCE(NULLIF(h.usuario_nombre, ''), au.nombre, 'Sistema') AS usuario_nombre,
         h.fecha_hora,
         r.fecha            AS registro_fecha,
         pu.nombre          AS profesor_nombre,
         l.nombre           AS lugar_nombre
    FROM registros_historial h
    LEFT JOIN usuarios  au ON au.id = h.usuario_id
    LEFT JOIN registros r  ON r.id  = h.registro_id
    LEFT JOIN usuarios  pu ON pu.id = r.profesor_id
    LEFT JOIN lugares   l  ON l.id  = r.lugar_id`;

/** Filtros del contrato. Solo tocan la tabla h, asi que sirven tambien al COUNT. */
function filtrosHistorial(q) {
  const cond = [];
  const params = [];

  if (q.registro_id) {
    const n = entero(q.registro_id);
    if (n === null || n <= 0) throw fallo(400, 'El registro indicado no es válido.');
    cond.push('h.registro_id = ?');
    params.push(n);
  }

  if (q.usuario_id) {
    const n = entero(q.usuario_id);
    if (n === null || n <= 0) throw fallo(400, 'El usuario indicado no es válido.');
    cond.push('h.usuario_id = ?');
    params.push(n);
  }

  // fecha_hora es 'YYYY-MM-DD HH:MM:SS': la comparacion de texto alcanza y usa el indice.
  if (q.desde) {
    const d = texto(q.desde);
    if (!esFechaISO(d)) throw fallo(400, 'La fecha «desde» no es válida.');
    cond.push('h.fecha_hora >= ?');
    params.push(`${d} 00:00:00`);
  }

  if (q.hasta) {
    const d = texto(q.hasta);
    if (!esFechaISO(d)) throw fallo(400, 'La fecha «hasta» no es válida.');
    cond.push('h.fecha_hora <= ?');
    params.push(`${d} 23:59:59`);
  }

  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

router.get('/historial', asyncH((req, res) => {
  const q = req.query ?? {};
  const { where, params } = filtrosHistorial(q);

  const porPagina = Math.min(Math.max(entero(q.por_pagina) ?? POR_PAGINA_DEF, 1), POR_PAGINA_MAX);
  const total = consultarUna(`SELECT COUNT(*) AS n FROM registros_historial h ${where}`, params).n;
  const paginas = Math.max(Math.ceil(total / porPagina), 1);
  const pagina = Math.min(Math.max(entero(q.pagina) ?? 1, 1), paginas);

  const filas = consultar(
    `${SQL_HISTORIAL} ${where} ORDER BY h.fecha_hora DESC, h.id DESC LIMIT ? OFFSET ?`,
    [...params, porPagina, (pagina - 1) * porPagina],
  );

  const datos = filas.map((f) => ({
    ...f,
    // Nombre legible del campo tocado; vacio en creaciones y eliminaciones.
    etiqueta_campo: ETIQUETAS_CAMPOS[f.campo] ?? f.campo,
  }));

  res.json({ datos, total, pagina, por_pagina: porPagina, paginas });
}));

export default router;
