// REQ 4: validacion de datos.
//
// Unica fuente de verdad de las reglas de un registro. La usan el formulario
// (en vivo, mientras el profesor escribe) y el Route Handler antes de grabar.
// La base repite lo esencial como CHECK constraints, de modo que ni una carga
// masiva ni una consulta directa puedan saltear la regla.

import { esFechaISO, hoyISO } from './fechas';
import type { Catalogos, CuerpoRegistro } from './tipos';

export const LIMITES = {
  alumnosMax: 2000,        // tope de cordura: el record historico ronda los 160
  observacionesMax: 1000,
  antiguedadMaxDias: 365,
} as const;

export type ErroresCampo = Partial<Record<keyof CuerpoRegistro, string>>;

export interface ResultadoValidacion {
  valido: boolean;
  errores: ErroresCampo;
  datos: Omit<CuerpoRegistro, 'confirmar_duplicado'> | null;
}

function entero(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * Normaliza y valida el cuerpo de un registro.
 * Devuelve los errores como mapa campo -> mensaje, que es lo que el formulario
 * necesita para pintarlos donde corresponde en lugar de un cartel generico.
 */
export function validarRegistro(
  cuerpo: Partial<CuerpoRegistro> = {},
  catalogos: Partial<Catalogos> = {},
): ResultadoValidacion {
  const errores: ErroresCampo = {};
  const profesores = catalogos.profesores ?? [];
  const lugares = catalogos.lugares ?? [];
  const estados = catalogos.estados ?? [];

  // --- fecha ---------------------------------------------------------------
  const fecha = String(cuerpo.fecha ?? '').trim();
  if (!fecha) {
    errores.fecha = 'Indicá la fecha de la actividad.';
  } else if (!esFechaISO(fecha)) {
    errores.fecha = 'La fecha no es válida.';
  } else if (fecha > hoyISO()) {
    errores.fecha = 'No se pueden cargar clases con fecha futura.';
  } else {
    const limite = new Date();
    limite.setDate(limite.getDate() - LIMITES.antiguedadMaxDias);
    if (fecha < hoyISO(limite)) {
      errores.fecha = `No se pueden cargar clases de hace más de ${LIMITES.antiguedadMaxDias} días.`;
    }
  }

  // --- REQ 2: el profesor sale del listado de autorizados -------------------
  const profesorId = String(cuerpo.profesor_id ?? '').trim();
  if (!profesorId) {
    errores.profesor_id = 'Seleccioná el profesor responsable.';
  } else if (!profesores.some((p) => p.id === profesorId)) {
    errores.profesor_id = 'El profesor seleccionado no está en el listado de autorizados.';
  }

  // --- REQ 3: el lugar sale de los espacios definidos -----------------------
  const lugarId = entero(cuerpo.lugar_id);
  if (!lugarId) {
    errores.lugar_id = 'Seleccioná el lugar donde se desarrolló la actividad.';
  } else if (!lugares.some((l) => l.id === lugarId)) {
    errores.lugar_id = 'El lugar seleccionado no está habilitado.';
  }

  // --- estado de la clase ---------------------------------------------------
  const estadoCodigo = String(cuerpo.estado_codigo ?? '').trim();
  const estado = estados.find((e) => e.codigo === estadoCodigo);
  if (!estadoCodigo) errores.estado_codigo = 'Indicá el estado de la clase.';
  else if (!estado) errores.estado_codigo = 'El estado de la clase no es válido.';

  const suspendida = Boolean(estado?.es_suspension);

  // --- correo del responsable ----------------------------------------------
  const email = String(cuerpo.email_responsable ?? '').trim().toLowerCase();
  if (!email) {
    errores.email_responsable = 'Indicá el correo electrónico del responsable.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errores.email_responsable = 'El correo electrónico no tiene un formato válido.';
  }

  // --- REQ 4: campos numéricos ---------------------------------------------
  const total = entero(cuerpo.alumnos_total);
  const varones = entero(cuerpo.varones);
  const mujeres = entero(cuerpo.mujeres);
  const nuevos = entero(cuerpo.alumnos_nuevos ?? 0);

  const numericos: [keyof CuerpoRegistro, number | null, string][] = [
    ['alumnos_total', total, 'la cantidad total de alumnos'],
    ['varones', varones, 'la cantidad de varones'],
    ['mujeres', mujeres, 'la cantidad de mujeres'],
    ['alumnos_nuevos', nuevos, 'la cantidad de alumnos nuevos'],
  ];

  for (const [campo, valor, etiqueta] of numericos) {
    if (valor === null) {
      errores[campo] = `Indicá ${etiqueta} (un número entero).`;
    } else if (valor < 0) {
      errores[campo] = `${etiqueta[0].toUpperCase()}${etiqueta.slice(1)} no puede ser negativa.`;
    } else if (valor > LIMITES.alumnosMax) {
      errores[campo] = `El valor supera el máximo admitido (${LIMITES.alumnosMax}).`;
    }
  }

  // La comprobación central del REQ 4.
  if (!errores.alumnos_total && !errores.varones && !errores.mujeres) {
    const suma = (varones as number) + (mujeres as number);
    if (suma !== total) {
      errores.alumnos_total =
        `La suma de varones (${varones}) y mujeres (${mujeres}) da ${suma}, ` +
        `pero el total declarado es ${total}. Ambos valores tienen que coincidir.`;
      // Marca los otros dos campos sin repetir el texto.
      errores.varones ??= ' ';
      errores.mujeres ??= ' ';
    }
  }

  if (!errores.alumnos_total && !errores.alumnos_nuevos && (nuevos as number) > (total as number)) {
    errores.alumnos_nuevos =
      `Los alumnos nuevos (${nuevos}) no pueden superar el total de alumnos (${total}).`;
  }

  // Una clase suspendida no tuvo asistentes.
  if (suspendida && !errores.alumnos_total && (total as number) > 0) {
    errores.alumnos_total = 'Si la clase fue suspendida, la cantidad de alumnos tiene que ser 0.';
  }

  // --- observaciones --------------------------------------------------------
  const observaciones = String(cuerpo.observaciones ?? '').trim();
  if (observaciones.length > LIMITES.observacionesMax) {
    errores.observaciones =
      `Las observaciones no pueden superar los ${LIMITES.observacionesMax} caracteres.`;
  }
  // El motivo de suspensión alimenta el indicador del REQ 7.
  if (suspendida && !observaciones) {
    errores.observaciones = 'Indicá el motivo por el que se suspendió la clase.';
  }

  const valido = Object.keys(errores).length === 0;

  return {
    valido,
    errores,
    datos: valido
      ? {
          fecha,
          profesor_id: profesorId,
          lugar_id: lugarId as number,
          estado_codigo: estadoCodigo,
          alumnos_total: total as number,
          alumnos_nuevos: nuevos as number,
          varones: varones as number,
          mujeres: mujeres as number,
          observaciones,
          email_responsable: email,
        }
      : null,
  };
}

/** Etiquetas legibles de los campos que sigue el historial del REQ 6. */
export const ETIQUETAS_CAMPOS: Record<string, string> = {
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
