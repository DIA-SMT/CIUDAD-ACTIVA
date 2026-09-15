// REQ 4: validacion de datos.
//
// Unica fuente de verdad de las reglas de un registro. La usa la API en el
// alta y en la edicion; la base de datos repite las mismas reglas como
// CHECK constraints para que ningun camino alternativo pueda saltearlas.

import { esFechaISO, hoyISO } from './fechas.js';

export const LIMITES = {
  alumnosMax: 2000,        // tope de cordura: el record historico ronda los 160
  observacionesMax: 1000,
  antiguedadMaxDias: 365,  // no se cargan clases de hace mas de un ano
};

const entero = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/**
 * Normaliza y valida el cuerpo de un registro.
 *
 * @param {object} cuerpo  datos crudos del formulario o de la API
 * @param {object} ctx     { profesores, lugares, estados } catalogos vigentes
 * @returns {{ valido: boolean, errores: object, datos: object|null }}
 *          errores es un mapa campo -> mensaje, para pintarlo en el formulario.
 */
export function validarRegistro(cuerpo = {}, ctx = {}) {
  const errores = {};
  const profesores = ctx.profesores ?? [];
  const lugares = ctx.lugares ?? [];
  const estados = ctx.estados ?? [];

  // --- fecha ---------------------------------------------------------------
  const fecha = String(cuerpo.fecha ?? '').trim();
  if (!fecha) {
    errores.fecha = 'Indica la fecha de la actividad.';
  } else if (!esFechaISO(fecha)) {
    errores.fecha = 'La fecha no es valida. Usa el formato dia/mes/ano.';
  } else if (fecha > hoyISO()) {
    errores.fecha = 'No se pueden cargar clases con fecha futura.';
  } else {
    const limite = new Date();
    limite.setDate(limite.getDate() - LIMITES.antiguedadMaxDias);
    if (fecha < hoyISO(limite)) {
      errores.fecha = `No se pueden cargar clases de hace mas de ${LIMITES.antiguedadMaxDias} dias.`;
    }
  }

  // --- REQ 2: el profesor sale del listado de autorizados -------------------
  const profesorId = entero(cuerpo.profesor_id);
  const profesor = profesores.find((p) => p.id === profesorId);
  if (!profesorId) errores.profesor_id = 'Selecciona el profesor responsable.';
  else if (!profesor) errores.profesor_id = 'El profesor seleccionado no esta en el listado de autorizados.';

  // --- REQ 3: el lugar sale de los espacios definidos -----------------------
  const lugarId = entero(cuerpo.lugar_id);
  const lugar = lugares.find((l) => l.id === lugarId);
  if (!lugarId) errores.lugar_id = 'Selecciona el lugar donde se desarrollo la actividad.';
  else if (!lugar) errores.lugar_id = 'El lugar seleccionado no esta habilitado.';

  // --- estado de la clase ---------------------------------------------------
  const estadoCodigo = String(cuerpo.estado_codigo ?? '').trim();
  const estado = estados.find((e) => e.codigo === estadoCodigo);
  if (!estadoCodigo) errores.estado_codigo = 'Indica el estado de la clase.';
  else if (!estado) errores.estado_codigo = 'El estado de la clase no es valido.';

  const suspendida = Boolean(estado?.es_suspension);

  // --- correo del responsable ----------------------------------------------
  const email = String(cuerpo.email_responsable ?? '').trim().toLowerCase();
  if (!email) errores.email_responsable = 'Indica el correo electronico del responsable.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errores.email_responsable = 'El correo electronico no tiene un formato valido.';
  }

  // --- REQ 4: campos numericos ---------------------------------------------
  const total = entero(cuerpo.alumnos_total);
  const varones = entero(cuerpo.varones);
  const mujeres = entero(cuerpo.mujeres);
  const nuevos = entero(cuerpo.alumnos_nuevos ?? 0);

  const numericos = [
    ['alumnos_total', total, 'la cantidad total de alumnos'],
    ['varones', varones, 'la cantidad de varones'],
    ['mujeres', mujeres, 'la cantidad de mujeres'],
    ['alumnos_nuevos', nuevos, 'la cantidad de alumnos nuevos'],
  ];

  for (const [campo, valor, etiqueta] of numericos) {
    if (valor === null) errores[campo] = `Indica ${etiqueta} (un numero entero).`;
    else if (valor < 0) errores[campo] = `${etiqueta[0].toUpperCase()}${etiqueta.slice(1)} no puede ser negativa.`;
    else if (valor > LIMITES.alumnosMax) errores[campo] = `El valor supera el maximo admitido (${LIMITES.alumnosMax}).`;
  }

  if (!errores.alumnos_total && !errores.varones && !errores.mujeres) {
    // La comprobacion central del REQ 4.
    if (varones + mujeres !== total) {
      const suma = varones + mujeres;
      errores.alumnos_total =
        `La suma de varones (${varones}) y mujeres (${mujeres}) da ${suma}, ` +
        `pero el total declarado es ${total}. Ambos valores deben coincidir.`;
      errores.varones = errores.varones ?? ' ';
      errores.mujeres = errores.mujeres ?? ' ';
    }
  }

  if (!errores.alumnos_total && !errores.alumnos_nuevos && nuevos > total) {
    errores.alumnos_nuevos =
      `Los alumnos nuevos (${nuevos}) no pueden superar el total de alumnos (${total}).`;
  }

  // Una clase suspendida no tuvo asistentes.
  if (suspendida && !errores.alumnos_total && total > 0) {
    errores.alumnos_total = 'Si la clase fue suspendida, la cantidad de alumnos debe ser 0.';
  }

  // --- observaciones --------------------------------------------------------
  const observaciones = String(cuerpo.observaciones ?? '').trim();
  if (observaciones.length > LIMITES.observacionesMax) {
    errores.observaciones = `Las observaciones no pueden superar los ${LIMITES.observacionesMax} caracteres.`;
  }
  // El motivo de suspension alimenta el indicador del REQ 7.
  if (suspendida && !observaciones) {
    errores.observaciones = 'Indica el motivo por el que se suspendio la clase.';
  }

  const valido = Object.keys(errores).length === 0;

  return {
    valido,
    errores,
    datos: valido
      ? {
          fecha,
          profesor_id: profesorId,
          lugar_id: lugarId,
          estado_codigo: estadoCodigo,
          alumnos_total: total,
          alumnos_nuevos: nuevos,
          varones,
          mujeres,
          observaciones,
          email_responsable: email,
        }
      : null,
  };
}

/** Campos que el historial del REQ 6 sigue cuando se edita un registro. */
export const CAMPOS_AUDITABLES = [
  'fecha', 'profesor_id', 'lugar_id', 'estado_codigo',
  'alumnos_total', 'alumnos_nuevos', 'varones', 'mujeres',
  'observaciones', 'email_responsable',
];

export const ETIQUETAS_CAMPOS = {
  fecha: 'Fecha',
  profesor_id: 'Profesor',
  lugar_id: 'Lugar',
  estado_codigo: 'Estado de la clase',
  alumnos_total: 'Cantidad de alumnos',
  alumnos_nuevos: 'Alumnos nuevos',
  varones: 'Cantidad de varones',
  mujeres: 'Cantidad de mujeres',
  observaciones: 'Observaciones',
  email_responsable: 'Correo del responsable',
};
