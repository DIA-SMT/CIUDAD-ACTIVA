// Manejo central de errores de la API.
//
// Toda la aplicacion habla el mismo formato de error del contrato:
//   { "error": "mensaje para el usuario", "errores": { "campo": "detalle" } }
// y `errores` viaja solo en las validaciones (422), como pide el contrato.
//
// Las rutas no arman respuestas de error a mano: lanzan ErrorHttp (o dejan
// escapar el error de SQLite) y este archivo decide codigo y texto. Asi el
// profesor ve siempre un mensaje en castellano y nunca un volcado tecnico.

import { config } from '../config.js';
import { ahora } from '../lib/fechas.js';

/** Error con codigo HTTP y, opcionalmente, errores por campo para el formulario. */
export class ErrorHttp extends Error {
  constructor(estado, mensaje, errores = {}) {
    super(mensaje);
    this.name = 'ErrorHttp';
    this.estado = Number(estado) || 500;
    this.errores = errores && typeof errores === 'object' ? errores : {};
  }
}

/**
 * Envuelve un handler y deriva cualquier error a next().
 * Express 5 ya reenvia las promesas rechazadas, pero asyncH unifica el
 * tratamiento de los handlers sincronicos (node:sqlite lo es) con los async.
 */
export const asyncH = (fn) => (req, res, next) => {
  try {
    const resultado = fn(req, res, next);
    if (resultado && typeof resultado.then === 'function') {
      Promise.resolve(resultado).catch(next);
    }
    return resultado;
  } catch (error) {
    next(error);
    return undefined;
  }
};

/** 404 en JSON para cualquier ruta de /api que no exista. */
export function noEncontrado(req, res, next) {
  // Montado bajo /api; el guard evita robarle las rutas estaticas si alguien
  // lo monta en la raiz por error.
  if (!String(req.originalUrl || '').startsWith('/api')) return next();

  // El mensaje no repite la URL pedida: la ruta real queda en el log del
  // servidor, que es donde sirve.
  return next(new ErrorHttp(404, 'La dirección solicitada no existe en la API.'));
}

// ---------------------------------------------------------------------------
// Traduccion de los errores de la base
// ---------------------------------------------------------------------------

// node:sqlite lanza Error con code 'ERR_SQLITE_ERROR', errcode (codigo
// extendido de SQLite) y un message que incluye el nombre del constraint.
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CONSTRAINT_CHECK = 275;
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;
const SQLITE_CONSTRAINT_NOTNULL = 1299;
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;

const NEGATIVO = 'Debe ser un número entero de 0 en adelante.';

// UNIQUE: columna de la base -> mensaje. La clave es 'tabla.columna' tal como
// la nombra SQLite en el mensaje del error.
const DUPLICADOS = {
  'usuarios.email': 'Ya existe un usuario registrado con ese correo electrónico.',
  'usuarios.usuario': 'Ese nombre de usuario ya está en uso. Elige otro.',
  'lugares.nombre': 'Ya existe un lugar con ese nombre.',
  'estados_clase.nombre': 'Ya existe un estado de clase con ese nombre.',
  'sesiones.id': 'No se pudo iniciar la sesión. Vuelve a intentar.',
};

function esErrorSQLite(err) {
  return err?.code === 'ERR_SQLITE_ERROR'
    || typeof err?.errcode === 'number'
    || /constraint failed|SQLITE_/i.test(String(err?.message ?? ''));
}

/**
 * Convierte un error de SQLite en un ErrorHttp con texto util.
 * Las CHECK del esquema repiten las reglas del REQ 4, asi que cuando saltan
 * hay que explicarlas igual que las explicaria el formulario.
 */
function traducirSQLite(err) {
  const mensaje = String(err?.message ?? '');
  const codigo = Number(err?.errcode);

  if (mensaje.includes('ck_suma_sexos')) {
    return new ErrorHttp(422,
      'La suma de varones y mujeres debe ser igual a la cantidad total de alumnos.',
      {
        alumnos_total: 'Varones + mujeres tiene que dar exactamente este total.',
        varones: ' ',
        mujeres: ' ',
      });
  }

  if (mensaje.includes('ck_nuevos_en_total')) {
    return new ErrorHttp(422,
      'Los alumnos nuevos no pueden superar el total de alumnos de la clase.',
      { alumnos_nuevos: 'No puede ser mayor que la cantidad total de alumnos.' });
  }

  if (mensaje.includes('ck_no_negativos')) {
    return new ErrorHttp(422,
      'Las cantidades de alumnos no pueden ser negativas.',
      {
        alumnos_total: NEGATIVO,
        alumnos_nuevos: NEGATIVO,
        varones: NEGATIVO,
        mujeres: NEGATIVO,
      });
  }

  if (mensaje.includes('ck_fecha_formato')) {
    return new ErrorHttp(422, 'La fecha de la actividad no tiene un formato válido.',
      { fecha: 'Usa el formato día/mes/año.' });
  }

  if (codigo === SQLITE_CONSTRAINT_UNIQUE || codigo === SQLITE_CONSTRAINT_PRIMARYKEY
      || /UNIQUE constraint failed/i.test(mensaje)) {
    const columnas = (mensaje.split(':')[1] ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    const conocido = columnas.map((c) => DUPLICADOS[c]).find(Boolean);
    return new ErrorHttp(409, conocido ?? 'Ya existe un elemento con esos datos.');
  }

  if (codigo === SQLITE_CONSTRAINT_FOREIGNKEY || /FOREIGN KEY constraint failed/i.test(mensaje)) {
    // ON DELETE RESTRICT: el historico del REQ 5 no se borra en cascada.
    return new ErrorHttp(409,
      'No se puede completar la operación: el dato está relacionado con registros ya cargados. '
      + 'Si ya tiene actividades, desactívalo en lugar de eliminarlo.');
  }

  if (codigo === SQLITE_CONSTRAINT_NOTNULL || /NOT NULL constraint failed/i.test(mensaje)) {
    const columna = (mensaje.split(':')[1] ?? '').trim().split('.').pop();
    return new ErrorHttp(422,
      columna
        ? `Falta completar un dato obligatorio (${columna}).`
        : 'Falta completar un dato obligatorio.');
  }

  if (codigo === SQLITE_CONSTRAINT_CHECK || /CHECK constraint failed/i.test(mensaje)) {
    return new ErrorHttp(422,
      'Los datos no cumplen una de las reglas del sistema. Revisa los valores cargados.');
  }

  if (codigo === SQLITE_BUSY || codigo === SQLITE_LOCKED || /database is locked/i.test(mensaje)) {
    return new ErrorHttp(503,
      'La base de datos está ocupada en este momento. Espera unos segundos y vuelve a intentar.');
  }

  return new ErrorHttp(500, 'No se pudo completar la operación en la base de datos.');
}

/** Normaliza cualquier cosa lanzada en una ruta a { estado, mensaje, errores }. */
function normalizar(err) {
  if (err instanceof ErrorHttp) return err;

  // Errores de express.json(): cuerpo ilegible o demasiado grande.
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in (err ?? {}))) {
    return new ErrorHttp(400, 'El cuerpo del pedido no es JSON válido.');
  }
  if (err?.type === 'entity.too.large') {
    return new ErrorHttp(413, 'El contenido enviado es demasiado grande.');
  }

  if (esErrorSQLite(err)) return traducirSQLite(err);

  const estado = Number(err?.estado ?? err?.status ?? err?.statusCode);
  if (Number.isInteger(estado) && estado >= 400 && estado <= 599) {
    // Un error ajeno solo presta su texto si viene marcado como publicable.
    const mensaje = estado < 500 && (err?.expose === true || typeof err?.estado === 'number')
      ? String(err.message)
      : 'No se pudo completar la operación.';
    return new ErrorHttp(estado, mensaje, err?.errores ?? {});
  }

  return new ErrorHttp(500,
    'Ocurrió un error inesperado. Si vuelve a pasar, avisa a la Dirección de Deportes y Recreación.');
}

/** El error real siempre queda en el log del servidor, nunca se pierde. */
function registrar(err, req, estado) {
  const quien = req?.usuario ? `usuario=${req.usuario.usuario}` : 'usuario=anonimo';
  const ruta = `${req?.method ?? '-'} ${String(req?.originalUrl ?? '-').slice(0, 300)}`;
  const detalle = String(err?.message ?? err ?? 'error sin mensaje');

  console.error(`[${ahora()}] ${estado} ${ruta} ${quien} :: ${detalle}`);
  // El stack solo aporta en lo inesperado; los 4xx son parte del uso normal.
  if (estado >= 500 && err?.stack) console.error(err.stack);
}

/**
 * Manejador de errores de Express (la firma de 4 argumentos es obligatoria).
 * En produccion no devuelve stack ni detalles internos.
 */
export function manejadorErrores(err, req, res, next) {
  const http = normalizar(err);
  registrar(err, req, http.estado);

  // Si la respuesta ya empezo a viajar (por ejemplo el CSV), no se puede
  // reemplazar por JSON: que la corte Express.
  if (res.headersSent) return next(err);

  const cuerpo = { error: http.message };

  // El contrato: 'errores' solo en las validaciones.
  if (http.estado === 422 && Object.keys(http.errores).length > 0) {
    cuerpo.errores = http.errores;
  }

  if (!config.produccion && http.estado >= 500) {
    cuerpo.detalle = String(err?.message ?? '');
    if (err?.stack) cuerpo.stack = String(err.stack).split('\n').slice(0, 8);
  }

  return res.status(http.estado).json(cuerpo);
}
