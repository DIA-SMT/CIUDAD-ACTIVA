// REQ 1, 4, 5, 6 y 8: alta, consulta, edicion, baja, historial y exportacion
// de los registros de actividad. Se monta en /api/registros.
//
// Todo el subconjunto de datos que devuelve este modulo sale de la vista
// v_registros filtrada con filtrosRegistros(): es la misma funcion que usan las
// estadisticas, de modo que el listado y los indicadores nunca se contradicen.

import { Router } from 'express';

import { consultar, consultarUna, ejecutar, enTransaccion, filtrosRegistros } from '../db/index.js';
import { validarRegistro, CAMPOS_AUDITABLES, ETIQUETAS_CAMPOS } from '../lib/validacion.js';
import { hoyISO, ahora, diasEntre } from '../lib/fechas.js';
import { ErrorHttp, asyncH } from '../middleware/errores.js';
import { requiereSesion } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();

// Guarda a nivel de router: cada handler vuelve a pedir la sesion porque
// necesita el perfil, pero esto asegura que una ruta nueva que se olvide de
// hacerlo no quede expuesta.
router.use(requiereSesion);

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Filtros del REQ 8 admitidos por query string. Nada fuera de esta lista pasa. */
const CLAVES_FILTRO = ['desde', 'hasta', 'profesor_id', 'lugar_id', 'estado', 'q'];

/** Lista blanca de ordenamientos. El valor se interpola en el SQL, por eso
 *  nunca puede venir del pedido: solo se usa la clave para elegir de aca. */
const ORDENES = {
  fecha_desc: 'fecha DESC, id DESC',
  fecha_asc: 'fecha ASC, id ASC',
  alumnos_desc: 'alumnos_total DESC, fecha DESC, id DESC',
  creado_desc: 'creado_en DESC, id DESC',
};

const POR_PAGINA_DEFECTO = 25;
const POR_PAGINA_MAX = 200;

const CABECERAS_CSV = [
  'N° de registro', 'Fecha', 'Profesor', 'Cargo', 'Lugar', 'Estado de la clase',
  'Suspendida', 'Total de alumnos', 'Alumnos nuevos', 'Varones', 'Mujeres',
  'Observaciones', 'Correo del responsable', 'Cargado por',
  'Fecha de carga', 'Última modificación',
];

// ---------------------------------------------------------------------------
// Ayudas generales
// ---------------------------------------------------------------------------

/** El middleware de sesion deja el perfil autenticado en req.usuario. */
function sesionActual(req) {
  const usuario = req.usuario;
  if (!usuario) throw new ErrorHttp(401, 'Tu sesión expiró. Volvé a ingresar.');
  return usuario;
}

const esAdmin = (usuario) => usuario.rol === 'admin';

const enteroPositivo = (valor, defecto) => {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : defecto;
};

/** Verdadero para true, 'true', 1 y '1'. El formulario manda texto. */
const esVerdadero = (valor) => valor === true || valor === 1 || valor === 'true' || valor === '1';

/** Un campo se considera enviado si no es undefined ni null. */
const presente = (valor) => valor !== undefined && valor !== null;

const plural = (n, singular, varios) => `${n} ${n === 1 ? singular : varios}`;

/** '2026-09-08' -> '08/09/2026' */
const fechaLegible = (iso) => {
  const [a, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : String(iso ?? '');
};

/** '2026-09-08 19:56:04' -> '08/09/2026 19:56' */
const fechaHoraLegible = (sello) => {
  const s = String(sello ?? '');
  return s ? `${fechaLegible(s.slice(0, 10))} ${s.slice(11, 16)}`.trim() : '';
};

function idDeParam(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ErrorHttp(400, 'El identificador del registro no es válido.');
  }
  return n;
}

/**
 * Deja la query cruda en el objeto que espera filtrosRegistros(): solo las
 * claves del contrato, sin vacios y con los ids ya numericos. Se descarta lo
 * que no sea un id o una fecha valida para no llegar a la base con basura.
 */
function filtrosDeQuery(query = {}) {
  const filtros = {};

  for (const clave of CLAVES_FILTRO) {
    const crudo = query[clave];
    const texto = String((Array.isArray(crudo) ? crudo[0] : crudo) ?? '').trim();
    if (!texto) continue;

    if (clave === 'profesor_id' || clave === 'lugar_id') {
      const n = Number(texto);
      if (Number.isInteger(n) && n > 0) filtros[clave] = n;
    } else if (clave === 'desde' || clave === 'hasta') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) filtros[clave] = texto;
    } else {
      filtros[clave] = texto;
    }
  }

  return filtros;
}

/** Clave de ORDENES pedida, o la de por defecto si no esta en la lista blanca. */
function ordenDeQuery(query = {}, defecto = 'fecha_desc') {
  const pedido = String(query.orden ?? '').trim();
  return Object.hasOwn(ORDENES, pedido) ? pedido : defecto;
}

// ---------------------------------------------------------------------------
// Catalogos y lectura de registros
// ---------------------------------------------------------------------------

/**
 * Catalogos vigentes para validarRegistro(): los autorizados del REQ 2 y los
 * espacios del REQ 3. Solo lo activo, para que nadie pueda cargar contra un
 * profesor dado de baja ni contra un lugar que ya no se usa.
 */
function catalogosVigentes() {
  return {
    profesores: consultar(
      `SELECT id, nombre, cargo, email FROM usuarios
        WHERE activo = 1 AND dicta_clases = 1
        ORDER BY nombre`),
    lugares: consultar(
      `SELECT id, nombre FROM lugares WHERE activo = 1 ORDER BY orden, nombre`),
    estados: consultar(
      `SELECT codigo, nombre, es_suspension FROM estados_clase
        WHERE activo = 1 ORDER BY orden`),
  };
}

const leerRegistro = (id) => consultarUna('SELECT * FROM v_registros WHERE id = ?', [id]);

function exigirRegistro(id) {
  const registro = leerRegistro(id);
  if (!registro) throw new ErrorHttp(404, 'No encontramos el registro que buscás. Puede que ya se haya eliminado.');
  return registro;
}

/**
 * Registros con la misma fecha + profesor + lugar. No hay UNIQUE en la base a
 * proposito (hay dias con dos clases reales): el duplicado se avisa y el
 * usuario decide, no se bloquea.
 */
function buscarDuplicados({ fecha, profesor_id, lugar_id }, excluirId = null) {
  const sql = `SELECT * FROM v_registros
                WHERE fecha = ? AND profesor_id = ? AND lugar_id = ?
                  ${excluirId ? 'AND id <> ?' : ''}
                ORDER BY id`;
  const params = excluirId
    ? [fecha, profesor_id, lugar_id, excluirId]
    : [fecha, profesor_id, lugar_id];
  return consultar(sql, params);
}

/** Mensaje del 409: dice exactamente que clase ya estaba cargada. */
function avisoDuplicados(duplicados, datos) {
  const primero = duplicados[0];
  const cuantos = duplicados.length === 1
    ? 'Ya hay un registro cargado'
    : `Ya hay ${duplicados.length} registros cargados`;
  return `${cuantos} para el ${fechaLegible(datos.fecha)} en ${primero.lugar_nombre} `
    + `con ${primero.profesor_nombre}. Si de verdad se dictó otra clase, confirmá para guardarla igual.`;
}

// ---------------------------------------------------------------------------
// REQ 6: historial de modificaciones
// ---------------------------------------------------------------------------

const nombreProfesor = (id) =>
  consultarUna('SELECT nombre FROM usuarios WHERE id = ?', [Number(id)])?.nombre ?? String(id ?? '');

const nombreLugar = (id) =>
  consultarUna('SELECT nombre FROM lugares WHERE id = ?', [Number(id)])?.nombre ?? String(id ?? '');

const nombreEstado = (codigo) =>
  consultarUna('SELECT nombre FROM estados_clase WHERE codigo = ?', [String(codigo)])?.nombre ?? String(codigo ?? '');

/**
 * Valor de un campo tal como debe quedar escrito en el historial. Los tres
 * campos que son claves foraneas se guardan por su nombre legible: quien lee la
 * auditoria necesita "Plaza Urquiza", no "7". Se consulta sin filtrar por
 * activo, porque el valor anterior puede apuntar a algo ya dado de baja.
 */
function valorParaHistorial(campo, valor) {
  if (campo === 'profesor_id') return nombreProfesor(valor);
  if (campo === 'lugar_id') return nombreLugar(valor);
  if (campo === 'estado_codigo') return nombreEstado(valor);
  return String(valor ?? '');
}

/** Resumen de una linea del registro, para los asientos de alta y de baja. */
function resumenRegistro(r) {
  const partes = [fechaLegible(r.fecha), r.profesor_nombre, r.lugar_nombre, r.estado_nombre];
  if (!r.es_suspension) {
    partes.push(`${plural(r.alumnos_total, 'alumno', 'alumnos')} (${r.varones} varones, ${r.mujeres} mujeres)`);
    if (r.alumnos_nuevos) partes.push(plural(r.alumnos_nuevos, 'alumno nuevo', 'alumnos nuevos'));
  }
  if (r.observaciones) partes.push(r.observaciones);
  return partes.join(' · ');
}

function asentar({ registroId, accion, campo = '', anterior = '', nuevo = '', usuario, cuando }) {
  ejecutar(
    `INSERT INTO registros_historial
       (registro_id, accion, campo, valor_anterior, valor_nuevo,
        usuario_id, usuario_nombre, fecha_hora)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [registroId, accion, String(campo), String(anterior), String(nuevo),
      usuario.id, String(usuario.nombre ?? ''), cuando],
  );
}

// ---------------------------------------------------------------------------
// Validacion y permisos
// ---------------------------------------------------------------------------

/**
 * Valida el cuerpo contra los catalogos vigentes (REQ 4) y devuelve los datos
 * normalizados. Ante errores corta con 422; el cuerpo del 422 lleva el mapa
 * campo -> mensaje que el formulario pinta al lado de cada input.
 */
function validarOFallar(cuerpo) {
  const { valido, errores, datos } = validarRegistro(cuerpo, catalogosVigentes());
  if (!valido) {
    throw new ErrorHttp(422, 'Revisá los datos marcados y volvé a intentar.', errores);
  }
  return datos;
}

/**
 * REQ 6. El admin edita siempre. El profesor, solo lo propio y dentro de la
 * ventana de dias configurada: pasado ese plazo el dato ya se informo y el
 * cambio tiene que pasar por la Direccion.
 */
function exigirPermisoEdicion(usuario, registro) {
  if (esAdmin(usuario)) return;

  const propio = registro.profesor_id === usuario.id || registro.cargado_por === usuario.id;
  if (!propio) {
    throw new ErrorHttp(403,
      'Solo podés modificar los registros que cargaste vos o que figuran a tu nombre. '
      + 'Si necesitás cambiar este, pedíselo a un administrador.');
  }

  const dias = diasEntre(registro.fecha, hoyISO());
  const ventana = config.ventanaEdicionProfesorDias;
  if (dias > ventana) {
    throw new ErrorHttp(403,
      `La clase del ${fechaLegible(registro.fecha)} se dictó hace ${plural(dias, 'día', 'días')} `
      + `y tenés ${plural(ventana, 'día', 'días')} de plazo para modificarla. `
      + 'Pedile el cambio a un administrador.');
  }
}

/** Verdadero si el cuerpo trae un profesor distinto del esperado. */
function pidioOtroProfesor(valorPedido, profesorEsperado) {
  const texto = String(valorPedido ?? '').trim();
  return texto !== '' && Number(texto) !== profesorEsperado;
}

/** Un profesor carga siempre a su nombre, nunca en nombre de otro. */
function exigirAltaANombrePropio(usuario, cuerpo) {
  if (esAdmin(usuario)) return;
  if (pidioOtroProfesor(cuerpo.profesor_id, usuario.id)) {
    throw new ErrorHttp(403,
      'Solo podés cargar clases a tu nombre. Para cargar en nombre de otro profesor, '
      + 'pedíselo a un administrador.');
  }
}

/**
 * Un profesor no puede pasarle el registro a otro profesor. Se compara contra
 * el profesor que ya tiene el registro, no contra el usuario: un registro
 * puede estar a nombre de un tercero y haber sido cargado por quien lo edita.
 */
function exigirSinReasignar(usuario, actual, cuerpo) {
  if (esAdmin(usuario)) return;
  if (pidioOtroProfesor(cuerpo.profesor_id, actual.profesor_id)) {
    throw new ErrorHttp(403,
      'No podés reasignar el registro a otro profesor. Pedíselo a un administrador.');
  }
}

// ---------------------------------------------------------------------------
// GET / — listado paginado (REQ 5 y REQ 8)
// ---------------------------------------------------------------------------

router.get('/', asyncH(async (req, res) => {
  sesionActual(req);

  const { where, params } = filtrosRegistros(filtrosDeQuery(req.query));
  const orden = ORDENES[ordenDeQuery(req.query)];

  const porPagina = Math.min(POR_PAGINA_MAX, enteroPositivo(req.query.por_pagina, POR_PAGINA_DEFECTO));
  const pagina = enteroPositivo(req.query.pagina, 1);

  const total = consultarUna(`SELECT COUNT(*) AS n FROM v_registros ${where}`, params).n;
  const datos = consultar(
    `SELECT * FROM v_registros ${where} ORDER BY ${orden} LIMIT ? OFFSET ?`,
    [...params, porPagina, (pagina - 1) * porPagina],
  );

  res.json({
    datos,
    total,
    pagina,
    por_pagina: porPagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  });
}));

// ---------------------------------------------------------------------------
// GET /exportar.csv — mismos filtros, sin paginar
// Va antes que /:id porque si no ese comodin se comeria "exportar.csv".
// ---------------------------------------------------------------------------

/**
 * Una celda CSV. Se entrecomilla en cuanto aparece el separador, una comilla o
 * un salto de linea; las comillas internas se duplican. Sin esto, un ';' dentro
 * de las observaciones corre todas las columnas siguientes.
 */
function celdaCSV(valor) {
  const texto = String(valor ?? '').replace(/\r\n?/g, '\n');
  return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

const filaCSV = (celdas) => celdas.map(celdaCSV).join(';');

router.get('/exportar.csv', asyncH(async (req, res) => {
  sesionActual(req);

  const { where, params } = filtrosRegistros(filtrosDeQuery(req.query));
  const orden = ORDENES[ordenDeQuery(req.query, 'fecha_asc')];
  const registros = consultar(`SELECT * FROM v_registros ${where} ORDER BY ${orden}`, params);

  const lineas = [filaCSV(CABECERAS_CSV)];
  for (const r of registros) {
    lineas.push(filaCSV([
      r.id,
      fechaLegible(r.fecha),
      r.profesor_nombre,
      r.profesor_cargo,
      r.lugar_nombre,
      r.estado_nombre,
      r.es_suspension ? 'Sí' : 'No',
      r.alumnos_total,
      r.alumnos_nuevos,
      r.varones,
      r.mujeres,
      r.observaciones,
      r.email_responsable,
      r.cargado_por_nombre ?? '',
      fechaHoraLegible(r.creado_en),
      fechaHoraLegible(r.actualizado_en),
    ]));
  }

  // El BOM es lo que hace que Excel en español abra el archivo en UTF-8 y
  // respete los acentos; el separador ';' es el que espera con esa configuracion.
  const csv = `\uFEFF${lineas.join('\r\n')}\r\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ciudad-activa-${hoyISO()}.csv"`);
  res.send(csv);
}));

// ---------------------------------------------------------------------------
// POST / — alta (REQ 1)
// ---------------------------------------------------------------------------

router.post('/', asyncH(async (req, res) => {
  const usuario = sesionActual(req);
  const cuerpo = req.body ?? {};

  exigirAltaANombrePropio(usuario, cuerpo);

  const profesorPedido = String(cuerpo.profesor_id ?? '').trim();

  const datos = validarOFallar({
    ...cuerpo,
    // El profesor que no eligio a nadie carga a su nombre. Al admin se lo deja
    // vacio a proposito para que la validacion le reclame elegir uno.
    profesor_id: profesorPedido || (esAdmin(usuario) ? '' : usuario.id),
    // Si falta el correo del responsable se usa el de la sesion.
    email_responsable: String(cuerpo.email_responsable ?? '').trim() || usuario.email,
  });

  const duplicados = esVerdadero(cuerpo.confirmar_duplicado) ? [] : buscarDuplicados(datos);
  if (duplicados.length) {
    // 409 negociado: el cuerpo lleva los registros ya cargados para que el
    // formulario los muestre y el usuario confirme o corrija.
    return res.status(409).json({ error: avisoDuplicados(duplicados, datos), duplicados });
  }

  const cuando = ahora();
  const id = enTransaccion(() => {
    const alta = ejecutar(
      `INSERT INTO registros
         (fecha, profesor_id, lugar_id, estado_codigo,
          alumnos_total, alumnos_nuevos, varones, mujeres,
          observaciones, email_responsable,
          cargado_por, origen, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web', ?, ?)`,
      [datos.fecha, datos.profesor_id, datos.lugar_id, datos.estado_codigo,
        datos.alumnos_total, datos.alumnos_nuevos, datos.varones, datos.mujeres,
        datos.observaciones, datos.email_responsable, usuario.id, cuando, cuando],
    );

    const nuevoId = Number(alta.lastInsertRowid);
    asentar({
      registroId: nuevoId,
      accion: 'creacion',
      nuevo: resumenRegistro(leerRegistro(nuevoId)),
      usuario,
      cuando,
    });
    return nuevoId;
  });

  res.status(201).json({ registro: leerRegistro(id) });
}));

// ---------------------------------------------------------------------------
// GET /:id/historial — REQ 6
// ---------------------------------------------------------------------------

router.get('/:id/historial', asyncH(async (req, res) => {
  sesionActual(req);
  const id = idDeParam(req.params.id);

  const filas = consultar(
    `SELECT id, accion, campo, valor_anterior, valor_nuevo, usuario_nombre, fecha_hora
       FROM registros_historial
      WHERE registro_id = ?
      ORDER BY id DESC`,
    [id],
  );

  // Si no hay asientos ni registro, el id directamente no existio nunca. Un
  // registro eliminado si conserva su historial: esa es la idea del REQ 6.
  if (!filas.length && !leerRegistro(id)) {
    throw new ErrorHttp(404, 'No encontramos el registro que buscás.');
  }

  res.json({
    historial: filas.map((f) => ({
      ...f,
      etiqueta_campo: ETIQUETAS_CAMPOS[f.campo] ?? '',
    })),
  });
}));

// ---------------------------------------------------------------------------
// GET /:id — uno
// ---------------------------------------------------------------------------

router.get('/:id', asyncH(async (req, res) => {
  sesionActual(req);
  res.json({ registro: exigirRegistro(idDeParam(req.params.id)) });
}));

// ---------------------------------------------------------------------------
// PUT /:id — edicion (REQ 6)
// ---------------------------------------------------------------------------

router.put('/:id', asyncH(async (req, res) => {
  const usuario = sesionActual(req);
  const id = idDeParam(req.params.id);
  const cuerpo = req.body ?? {};

  const actual = exigirRegistro(id);
  exigirPermisoEdicion(usuario, actual);
  exigirSinReasignar(usuario, actual, cuerpo);

  // Lo que no venga en el cuerpo conserva el valor guardado: asi una pantalla
  // que solo corrige las observaciones no necesita reenviar todo el registro.
  const combinado = {};
  for (const campo of CAMPOS_AUDITABLES) {
    combinado[campo] = presente(cuerpo[campo]) ? cuerpo[campo] : actual[campo];
  }
  if (!String(cuerpo.email_responsable ?? '').trim()) {
    combinado.email_responsable = actual.email_responsable;
  }

  const datos = validarOFallar(combinado);

  const cambioLaClave = datos.fecha !== actual.fecha
    || datos.profesor_id !== actual.profesor_id
    || datos.lugar_id !== actual.lugar_id;

  // Solo se avisa si la edicion mueve el registro a una combinacion ya ocupada:
  // si la fecha, el profesor y el lugar siguen iguales, el duplicado que pudiera
  // existir ya fue confirmado en su momento y no hay que volver a preguntar.
  if (cambioLaClave && !esVerdadero(cuerpo.confirmar_duplicado)) {
    const duplicados = buscarDuplicados(datos, id);
    if (duplicados.length) {
      return res.status(409).json({ error: avisoDuplicados(duplicados, datos), duplicados });
    }
  }

  // Una fila de historial por campo modificado. Se comparan como texto porque
  // el cuerpo llega con numeros en string desde el formulario.
  const cambios = CAMPOS_AUDITABLES
    .filter((campo) => String(actual[campo] ?? '') !== String(datos[campo] ?? ''))
    .map((campo) => ({
      campo,
      anterior: valorParaHistorial(campo, actual[campo]),
      nuevo: valorParaHistorial(campo, datos[campo]),
    }));

  // Sin cambios reales no se toca nada: escribir actualizado_en o un asiento
  // vacio ensuciaria la auditoria del REQ 6.
  if (!cambios.length) return res.json({ registro: actual });

  const cuando = ahora();
  enTransaccion(() => {
    ejecutar(
      `UPDATE registros
          SET fecha = ?, profesor_id = ?, lugar_id = ?, estado_codigo = ?,
              alumnos_total = ?, alumnos_nuevos = ?, varones = ?, mujeres = ?,
              observaciones = ?, email_responsable = ?, actualizado_en = ?
        WHERE id = ?`,
      [datos.fecha, datos.profesor_id, datos.lugar_id, datos.estado_codigo,
        datos.alumnos_total, datos.alumnos_nuevos, datos.varones, datos.mujeres,
        datos.observaciones, datos.email_responsable, cuando, id],
    );

    for (const cambio of cambios) {
      asentar({ registroId: id, accion: 'modificacion', ...cambio, usuario, cuando });
    }
  });

  res.json({ registro: leerRegistro(id) });
}));

// ---------------------------------------------------------------------------
// DELETE /:id — baja, solo admin
// ---------------------------------------------------------------------------

router.delete('/:id', asyncH(async (req, res) => {
  const usuario = sesionActual(req);
  if (!esAdmin(usuario)) {
    throw new ErrorHttp(403, 'Solo un administrador puede eliminar registros. Si cargaste algo por error, pedí la baja a la Dirección.');
  }

  const id = idDeParam(req.params.id);
  const actual = exigirRegistro(id);
  const cuando = ahora();

  enTransaccion(() => {
    // El asiento va antes del DELETE para que quede el contenido previo.
    // registros_historial no tiene clave foranea a registros justamente para
    // que la auditoria sobreviva a la baja (REQ 5 y REQ 6).
    asentar({
      registroId: id,
      accion: 'eliminacion',
      anterior: resumenRegistro(actual),
      usuario,
      cuando,
    });
    ejecutar('DELETE FROM registros WHERE id = ?', [id]);
  });

  res.json({ ok: true });
}));

export default router;
