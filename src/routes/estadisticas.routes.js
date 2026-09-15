// REQ 7 - Estadisticas e indicadores del programa Ciudad Activa.
//
// DEFINICIONES. Son unicas para todo el sistema y este archivo no las
// reinterpreta en ningun calculo; si manana se agrega un indicador, tiene que
// seguir estas mismas reglas:
//
//   * "clase registrada" = cualquier fila del subconjunto filtrado, con las
//     suspendidas incluidas. Es el denominador del porcentaje de suspensiones.
//   * "clase realizada"  = es_suspension = 0. Es lo que se cuenta como clase
//     efectivamente dictada en todos los indicadores de actividad.
//   * Los totales de alumnos (total, nuevos, varones, mujeres), los promedios y
//     la distribucion por sexo se calculan SOLO sobre clases realizadas: una
//     clase suspendida no tuvo asistentes y no debe diluir ningun promedio.
//   * "profesores_activos" y "lugares_activos" cuentan a quienes tienen al
//     menos una clase realizada dentro del subconjunto filtrado.
//   * Los porcentajes y los promedios se calculan aca, en el servidor,
//     redondeados a un decimal, y valen 0 cuando el denominador es 0. Ningun
//     campo numerico sale como NaN, null ni Infinity.
//
// El subconjunto siempre se arma con filtrosRegistros() sobre la vista
// v_registros: es la misma funcion que usa el listado, de modo que el tablero y
// la tabla del REQ 8 miran exactamente las mismas filas.

import { Router } from 'express';
import { consultar, consultarUna, filtrosRegistros } from '../db/index.js';
import { periodoLegible } from '../lib/fechas.js';
import { requiereSesion } from '../middleware/auth.js';
import { asyncH } from '../middleware/errores.js';

const router = Router();

// ---------------------------------------------------------------------------
// Ayudas numericas
// ---------------------------------------------------------------------------

/** Numero seguro: SUM() sobre cero filas devuelve NULL y no debe salir asi. */
const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Redondeo a un decimal, siempre finito. */
const unDecimal = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
};

/** Porcentaje de parte sobre total, con un decimal. 0 si el total es 0. */
const porcentaje = (parte, total) => {
  const t = numero(total);
  return t > 0 ? unDecimal((numero(parte) * 100) / t) : 0;
};

/** Promedio de alumnos por clase, con un decimal. 0 si no hubo clases. */
const promedio = (alumnos, clases) => {
  const c = numero(clases);
  return c > 0 ? unDecimal(numero(alumnos) / c) : 0;
};

// ---------------------------------------------------------------------------
// Fragmentos SQL reutilizados
//
// Son literales de este archivo, nunca texto que venga del pedido: los valores
// de los filtros viajan siempre como parametros posicionales (?).
// ---------------------------------------------------------------------------

const CLASES_REALIZADAS = 'SUM(CASE WHEN es_suspension = 0 THEN 1 ELSE 0 END)';
const CLASES_SUSPENDIDAS = 'SUM(CASE WHEN es_suspension = 1 THEN 1 ELSE 0 END)';

/** Suma de una columna contando unicamente las clases realizadas. */
const sumaRealizadas = (columna) =>
  `SUM(CASE WHEN es_suspension = 0 THEN ${columna} ELSE 0 END)`;

// ---------------------------------------------------------------------------
// Agrupamiento temporal de /evolucion y de /sexo
//
// La expresion sale de esta tabla fija; el parametro "agrupar" del pedido solo
// elige una clave, nunca se interpola en el SQL.
// ---------------------------------------------------------------------------

/** '2026-09-08' -> '08/09/2026' */
function etiquetaDia(periodo) {
  const [a, m, d] = String(periodo).split('-');
  return d ? `${d}/${m}/${a}` : String(periodo);
}

/** '2026-W36' -> 'Sem. 36 de 2026' */
function etiquetaSemana(periodo) {
  const [a, s] = String(periodo).split('-W');
  return s === undefined ? String(periodo) : `Sem. ${Number(s)} de ${a}`;
}

const AGRUPACIONES = {
  dia: { expresion: 'fecha', etiqueta: etiquetaDia },
  semana: { expresion: "strftime('%Y-W%W', fecha)", etiqueta: etiquetaSemana },
  mes: { expresion: "strftime('%Y-%m', fecha)", etiqueta: periodoLegible },
};

// ---------------------------------------------------------------------------
// Lectura de los filtros comunes (REQ 8)
// ---------------------------------------------------------------------------

/** Filtros del REQ 8 admitidos por query string. Nada fuera de esta lista pasa. */
const CLAVES_FILTRO = ['desde', 'hasta', 'profesor_id', 'lugar_id', 'estado', 'q'];

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Deja en req.filtros los filtros ya normalizados y en req.agrupacion el
 * agrupamiento temporal elegido.
 *
 * La lectura es a proposito igual de tolerante que la del listado
 * (registros.routes.js): un valor mal formado se ignora en lugar de cortar el
 * pedido. Si una ruta fuera estricta y la otra no, con la misma query la tabla
 * y los indicadores terminarian mirando subconjuntos distintos, que es
 * justamente lo que el REQ 8 pide evitar.
 */
function prepararFiltros(req, res, next) {
  const query = req.query ?? {};
  const filtros = {};

  for (const clave of CLAVES_FILTRO) {
    const crudo = query[clave];
    const texto = String(Array.isArray(crudo) ? crudo[0] ?? '' : crudo ?? '').trim();
    if (!texto) continue;

    if (clave === 'profesor_id' || clave === 'lugar_id') {
      const n = Number(texto);
      if (Number.isInteger(n) && n > 0) filtros[clave] = n;
    } else if (clave === 'desde' || clave === 'hasta') {
      if (FORMATO_FECHA.test(texto)) filtros[clave] = texto;
    } else {
      filtros[clave] = texto;
    }
  }

  const pedido = String(query.agrupar ?? '').trim();

  req.filtros = filtros;
  req.agrupacion = AGRUPACIONES[Object.hasOwn(AGRUPACIONES, pedido) ? pedido : 'mes'];
  return next();
}

router.use(requiereSesion);
router.use(prepararFiltros);

// ---------------------------------------------------------------------------
// Calculos. Las rutas sueltas y /tablero usan estas mismas funciones, asi que
// el SQL de cada indicador existe una sola vez.
// ---------------------------------------------------------------------------

/** Indicadores generales del periodo filtrado. */
function calcularResumen(filtros) {
  const { where, params } = filtrosRegistros(filtros);

  const fila = consultarUna(
    `SELECT
       COUNT(*)                            AS clases_registradas,
       ${CLASES_REALIZADAS}                AS clases_realizadas,
       ${CLASES_SUSPENDIDAS}               AS clases_suspendidas,
       ${sumaRealizadas('alumnos_total')}  AS alumnos_total,
       ${sumaRealizadas('alumnos_nuevos')} AS alumnos_nuevos,
       ${sumaRealizadas('varones')}        AS varones,
       ${sumaRealizadas('mujeres')}        AS mujeres,
       COUNT(DISTINCT CASE WHEN es_suspension = 0 THEN profesor_id END) AS profesores_activos,
       COUNT(DISTINCT CASE WHEN es_suspension = 0 THEN lugar_id    END) AS lugares_activos,
       MIN(fecha) AS primera_fecha,
       MAX(fecha) AS ultima_fecha
     FROM v_registros
     ${where}`,
    params,
  ) ?? {};

  const registradas = numero(fila.clases_registradas);
  const realizadas = numero(fila.clases_realizadas);
  const suspendidas = numero(fila.clases_suspendidas);
  const alumnos = numero(fila.alumnos_total);
  const varones = numero(fila.varones);
  const mujeres = numero(fila.mujeres);
  // varones + mujeres = alumnos_total por CHECK de la base; se usa la suma como
  // denominador para que los dos porcentajes de sexo siempre cierren en 100.
  const porSexo = varones + mujeres;

  return {
    clases_registradas: registradas,
    clases_realizadas: realizadas,
    clases_suspendidas: suspendidas,
    porcentaje_suspendidas: porcentaje(suspendidas, registradas),
    alumnos_total: alumnos,
    alumnos_nuevos: numero(fila.alumnos_nuevos),
    varones,
    mujeres,
    porcentaje_varones: porcentaje(varones, porSexo),
    porcentaje_mujeres: porcentaje(mujeres, porSexo),
    promedio_por_clase: promedio(alumnos, realizadas),
    profesores_activos: numero(fila.profesores_activos),
    lugares_activos: numero(fila.lugares_activos),
    primera_fecha: fila.primera_fecha ?? null,
    ultima_fecha: fila.ultima_fecha ?? null,
  };
}

/** Clases y alumnos por profesor, de mayor a menor cantidad de alumnos. */
function calcularPorProfesor(filtros) {
  const { where, params } = filtrosRegistros(filtros);

  const filas = consultar(
    `SELECT
       profesor_id,
       profesor_nombre                     AS profesor,
       profesor_cargo                      AS cargo,
       ${CLASES_REALIZADAS}                AS clases,
       ${CLASES_SUSPENDIDAS}               AS suspendidas,
       ${sumaRealizadas('alumnos_total')}  AS alumnos,
       ${sumaRealizadas('alumnos_nuevos')} AS alumnos_nuevos
     FROM v_registros
     ${where}
     GROUP BY profesor_id, profesor_nombre, profesor_cargo
     ORDER BY alumnos DESC, clases DESC, profesor ASC`,
    params,
  );

  return filas.map((f) => ({
    profesor_id: numero(f.profesor_id),
    profesor: f.profesor ?? '',
    cargo: f.cargo ?? '',
    clases: numero(f.clases),
    alumnos: numero(f.alumnos),
    alumnos_nuevos: numero(f.alumnos_nuevos),
    promedio: promedio(f.alumnos, f.clases),
    suspendidas: numero(f.suspendidas),
  }));
}

/**
 * Clases y alumnos por lugar. ultima_clase es la fecha de la ultima clase
 * realizada en el espacio: es el indicador de nivel de actividad del REQ 7.
 */
function calcularPorLugar(filtros) {
  const { where, params } = filtrosRegistros(filtros);

  const filas = consultar(
    `SELECT
       lugar_id,
       lugar_nombre                        AS lugar,
       ${CLASES_REALIZADAS}                AS clases,
       ${CLASES_SUSPENDIDAS}               AS suspendidas,
       ${sumaRealizadas('alumnos_total')}  AS alumnos,
       ${sumaRealizadas('alumnos_nuevos')} AS alumnos_nuevos,
       MAX(CASE WHEN es_suspension = 0 THEN fecha END) AS ultima_clase
     FROM v_registros
     ${where}
     GROUP BY lugar_id, lugar_nombre
     ORDER BY alumnos DESC, clases DESC, lugar ASC`,
    params,
  );

  return filas.map((f) => ({
    lugar_id: numero(f.lugar_id),
    lugar: f.lugar ?? '',
    clases: numero(f.clases),
    alumnos: numero(f.alumnos),
    alumnos_nuevos: numero(f.alumnos_nuevos),
    promedio: promedio(f.alumnos, f.clases),
    suspendidas: numero(f.suspendidas),
    ultima_clase: f.ultima_clase ?? null,
  }));
}

/**
 * Evolucion de la matricula por periodo, en orden cronologico.
 * Solo aparecen los periodos que tienen registros: los huecos no se rellenan,
 * el grafico dibuja lo que llega.
 */
function calcularEvolucion(filtros, agrupacion) {
  const { where, params } = filtrosRegistros(filtros);
  const { expresion, etiqueta } = agrupacion;

  const filas = consultar(
    `SELECT
       ${expresion}                        AS periodo,
       ${CLASES_REALIZADAS}                AS clases,
       ${sumaRealizadas('alumnos_total')}  AS alumnos,
       ${sumaRealizadas('alumnos_nuevos')} AS alumnos_nuevos
     FROM v_registros
     ${where}
     GROUP BY ${expresion}
     ORDER BY ${expresion} ASC`,
    params,
  );

  return filas.map((f) => ({
    periodo: String(f.periodo ?? ''),
    etiqueta: etiqueta(f.periodo),
    clases: numero(f.clases),
    alumnos: numero(f.alumnos),
    alumnos_nuevos: numero(f.alumnos_nuevos),
    promedio: promedio(f.alumnos, f.clases),
  }));
}

/** Distribucion por sexo, total y periodo a periodo. */
function calcularSexo(filtros, agrupacion, resumen = calcularResumen(filtros)) {
  const { where, params } = filtrosRegistros(filtros);
  const { expresion, etiqueta } = agrupacion;

  const filas = consultar(
    `SELECT
       ${expresion}                  AS periodo,
       ${sumaRealizadas('varones')}  AS varones,
       ${sumaRealizadas('mujeres')}  AS mujeres
     FROM v_registros
     ${where}
     GROUP BY ${expresion}
     ORDER BY ${expresion} ASC`,
    params,
  );

  return {
    varones: resumen.varones,
    mujeres: resumen.mujeres,
    porcentaje_varones: resumen.porcentaje_varones,
    porcentaje_mujeres: resumen.porcentaje_mujeres,
    por_periodo: filas.map((f) => ({
      periodo: String(f.periodo ?? ''),
      etiqueta: etiqueta(f.periodo),
      varones: numero(f.varones),
      mujeres: numero(f.mujeres),
    })),
  };
}

// El detalle de suspensiones se acota a las mas recientes: alcanza para leer
// los motivos concretos sin mandar el historico entero al navegador.
const LIMITE_DETALLE = 200;

/**
 * Cantidad y porcentaje de clases suspendidas, motivos y detalle.
 * El porcentaje se mide sobre las clases registradas; el de cada motivo, sobre
 * el total de suspensiones, que es lo que responde "por que se suspendio".
 */
function calcularSuspensiones(filtros, resumen = calcularResumen(filtros)) {
  const total = resumen.clases_suspendidas;

  // filtrosRegistros entiende solo_suspendidas: se mantiene una sola definicion
  // de los filtros tambien para este recorte.
  const { where, params } = filtrosRegistros({ ...filtros, solo_suspendidas: true });

  const motivos = consultar(
    `SELECT estado_codigo AS codigo,
            estado_nombre AS nombre,
            COUNT(*)      AS cantidad
     FROM v_registros
     ${where}
     GROUP BY estado_codigo, estado_nombre
     ORDER BY cantidad DESC, nombre ASC`,
    params,
  );

  const porLugar = consultar(
    `SELECT lugar_nombre AS lugar,
            COUNT(*)     AS cantidad
     FROM v_registros
     ${where}
     GROUP BY lugar_id, lugar_nombre
     ORDER BY cantidad DESC, lugar ASC`,
    params,
  );

  const detalle = consultar(
    `SELECT id, fecha,
            lugar_nombre    AS lugar,
            profesor_nombre AS profesor,
            estado_nombre,
            observaciones
     FROM v_registros
     ${where}
     ORDER BY fecha DESC, id DESC
     LIMIT ?`,
    [...params, LIMITE_DETALLE],
  );

  return {
    total,
    porcentaje: resumen.porcentaje_suspendidas,
    por_motivo: motivos.map((m) => ({
      codigo: m.codigo ?? '',
      nombre: m.nombre ?? '',
      cantidad: numero(m.cantidad),
      porcentaje: porcentaje(m.cantidad, total),
    })),
    por_lugar: porLugar.map((l) => ({
      lugar: l.lugar ?? '',
      cantidad: numero(l.cantidad),
    })),
    detalle: detalle.map((d) => ({
      id: numero(d.id),
      fecha: d.fecha ?? '',
      lugar: d.lugar ?? '',
      profesor: d.profesor ?? '',
      estado_nombre: d.estado_nombre ?? '',
      observaciones: d.observaciones ?? '',
    })),
  };
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

router.get('/resumen', asyncH(async (req, res) => {
  res.json(calcularResumen(req.filtros));
}));

router.get('/por-profesor', asyncH(async (req, res) => {
  res.json(calcularPorProfesor(req.filtros));
}));

router.get('/por-lugar', asyncH(async (req, res) => {
  res.json(calcularPorLugar(req.filtros));
}));

router.get('/evolucion', asyncH(async (req, res) => {
  res.json(calcularEvolucion(req.filtros, req.agrupacion));
}));

router.get('/sexo', asyncH(async (req, res) => {
  res.json(calcularSexo(req.filtros, req.agrupacion));
}));

router.get('/suspensiones', asyncH(async (req, res) => {
  res.json(calcularSuspensiones(req.filtros));
}));

// Una sola llamada para todo el panel: el resumen se calcula una vez y se
// reparte a las partes que lo necesitan.
router.get('/tablero', asyncH(async (req, res) => {
  const { filtros, agrupacion } = req;
  const resumen = calcularResumen(filtros);

  res.json({
    resumen,
    por_profesor: calcularPorProfesor(filtros),
    por_lugar: calcularPorLugar(filtros),
    evolucion: calcularEvolucion(filtros, agrupacion),
    sexo: calcularSexo(filtros, agrupacion, resumen),
    suspensiones: calcularSuspensiones(filtros, resumen),
  });
}));

export default router;
