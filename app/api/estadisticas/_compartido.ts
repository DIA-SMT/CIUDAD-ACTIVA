// REQ 7: base comun de los siete indicadores de /api/estadisticas.
//
// Los calculos viven en las funciones SQL de supabase/migrations/0002_estadisticas.sql
// (security invoker, asi que RLS sigue aplicando). Estos handlers son la capa
// fina que las llama: sesion, filtros del REQ 8, rpc y respuesta.
//
// El criterio esta una sola vez aca a proposito. Si cada route.ts leyera los
// filtros o tradujera los errores por su cuenta, el tablero podria terminar
// contando un subconjunto de clases y la tabla del listado otro, que es la peor
// falla posible en un sistema que se usa para informar.

import {
  error,
  errorDePostgres,
  filtrosDeQuery,
  parametrosRPC,
} from '@/lib/consultas';
import { periodoLegible } from '@/lib/fechas';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';
import type {
  Agrupacion,
  DistribucionSexo,
  FilaLugar,
  FilaProfesor,
  PuntoEvolucion,
  Resumen,
  Suspensiones,
  Tablero,
} from '@/lib/tipos';

// ---------------------------------------------------------------------------
// Corte temporal de las series
// ---------------------------------------------------------------------------

const AGRUPACIONES: readonly Agrupacion[] = ['dia', 'semana', 'mes'];

/**
 * Agrupamiento pedido por query string, validado contra la lista blanca.
 * Cualquier otro valor cae en 'mes', que es la vista por defecto del panel.
 * Se acepta tambien 'p_agrupar' porque es el nombre del parametro de la
 * funcion SQL y aparece escrito asi en el contrato.
 */
export function agrupacionDeQuery(sp: URLSearchParams): Agrupacion {
  const pedido = (sp.get('agrupar') ?? sp.get('p_agrupar') ?? '').trim();
  return AGRUPACIONES.find((a) => a === pedido) ?? 'mes';
}

// ---------------------------------------------------------------------------
// Normalizacion de lo que devuelve la base
//
// Cada normalizar* arma la forma exacta de lib/tipos.ts campo por campo. Como
// un campo ausente se resuelve en 0, '' o [], pasarle null (una RPC que no
// matcheo ninguna fila) devuelve la estructura vacia coherente, nunca null:
// el tablero dibuja un panel en cero en lugar de tener que defenderse.
// ---------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Fecha de negocio 'YYYY-MM-DD', o null si no vino. */
const fecha = (v: unknown): string | null => texto(v).slice(0, 10) || null;

/**
 * Objeto de la respuesta. Una funcion declarada "returns table" llega como
 * arreglo de una fila y una que devuelve jsonb como objeto suelto; se toman
 * las dos formas para no atarse a como quedo escrita la migracion.
 */
function objeto(dato: unknown): Record<string, unknown> {
  const valor = Array.isArray(dato) ? dato[0] : dato;
  return typeof valor === 'object' && valor !== null
    ? (valor as Record<string, unknown>)
    : {};
}

/** Filas de la respuesta. Lo que no sea un arreglo de objetos se descarta. */
function filas(dato: unknown): Record<string, unknown>[] {
  if (!Array.isArray(dato)) return [];
  return dato.filter(
    (f): f is Record<string, unknown> => typeof f === 'object' && f !== null,
  );
}

/** La etiqueta la arma el SQL; si no vino, se deduce del periodo. */
const etiquetaDe = (o: Record<string, unknown>): string =>
  texto(o.etiqueta) || periodoLegible(texto(o.periodo));

export function normalizarResumen(dato: unknown): Resumen {
  const o = objeto(dato);
  return {
    clases_registradas: num(o.clases_registradas),
    clases_realizadas: num(o.clases_realizadas),
    clases_suspendidas: num(o.clases_suspendidas),
    porcentaje_suspendidas: num(o.porcentaje_suspendidas),
    alumnos_total: num(o.alumnos_total),
    alumnos_nuevos: num(o.alumnos_nuevos),
    varones: num(o.varones),
    mujeres: num(o.mujeres),
    porcentaje_varones: num(o.porcentaje_varones),
    porcentaje_mujeres: num(o.porcentaje_mujeres),
    promedio_por_clase: num(o.promedio_por_clase),
    profesores_activos: num(o.profesores_activos),
    lugares_activos: num(o.lugares_activos),
    primera_fecha: fecha(o.primera_fecha),
    ultima_fecha: fecha(o.ultima_fecha),
  };
}

export function normalizarPorProfesor(dato: unknown): FilaProfesor[] {
  return filas(dato).map((o) => ({
    // profesor_id es uuid (viene de auth.users), no un entero.
    profesor_id: texto(o.profesor_id),
    profesor: texto(o.profesor),
    cargo: texto(o.cargo),
    clases: num(o.clases),
    alumnos: num(o.alumnos),
    alumnos_nuevos: num(o.alumnos_nuevos),
    promedio: num(o.promedio),
    suspendidas: num(o.suspendidas),
  }));
}

export function normalizarPorLugar(dato: unknown): FilaLugar[] {
  return filas(dato).map((o) => ({
    lugar_id: num(o.lugar_id),
    lugar: texto(o.lugar),
    clases: num(o.clases),
    alumnos: num(o.alumnos),
    alumnos_nuevos: num(o.alumnos_nuevos),
    promedio: num(o.promedio),
    suspendidas: num(o.suspendidas),
    // Nivel de actividad del espacio: ultima clase efectivamente realizada.
    ultima_clase: fecha(o.ultima_clase),
  }));
}

export function normalizarEvolucion(dato: unknown): PuntoEvolucion[] {
  return filas(dato).map((o) => ({
    periodo: texto(o.periodo),
    etiqueta: etiquetaDe(o),
    clases: num(o.clases),
    alumnos: num(o.alumnos),
    alumnos_nuevos: num(o.alumnos_nuevos),
    promedio: num(o.promedio),
  }));
}

export function normalizarSexo(dato: unknown): DistribucionSexo {
  const o = objeto(dato);
  return {
    varones: num(o.varones),
    mujeres: num(o.mujeres),
    porcentaje_varones: num(o.porcentaje_varones),
    porcentaje_mujeres: num(o.porcentaje_mujeres),
    por_periodo: filas(o.por_periodo).map((p) => ({
      periodo: texto(p.periodo),
      etiqueta: etiquetaDe(p),
      varones: num(p.varones),
      mujeres: num(p.mujeres),
    })),
  };
}

export function normalizarSuspensiones(dato: unknown): Suspensiones {
  const o = objeto(dato);
  return {
    total: num(o.total),
    porcentaje: num(o.porcentaje),
    por_motivo: filas(o.por_motivo).map((m) => ({
      codigo: texto(m.codigo),
      nombre: texto(m.nombre),
      cantidad: num(m.cantidad),
      porcentaje: num(m.porcentaje),
    })),
    por_lugar: filas(o.por_lugar).map((l) => ({
      lugar: texto(l.lugar),
      cantidad: num(l.cantidad),
    })),
    // El motivo concreto que escribio el profesor en observaciones.
    detalle: filas(o.detalle).map((d) => ({
      id: num(d.id),
      fecha: texto(d.fecha).slice(0, 10),
      lugar: texto(d.lugar),
      profesor: texto(d.profesor),
      estado_nombre: texto(d.estado_nombre),
      observaciones: texto(d.observaciones),
    })),
  };
}

export function normalizarTablero(dato: unknown): Tablero {
  const o = objeto(dato);
  return {
    resumen: normalizarResumen(o.resumen),
    por_profesor: normalizarPorProfesor(o.por_profesor),
    por_lugar: normalizarPorLugar(o.por_lugar),
    evolucion: normalizarEvolucion(o.evolucion),
    sexo: normalizarSexo(o.sexo),
    suspensiones: normalizarSuspensiones(o.suspensiones),
  };
}

// ---------------------------------------------------------------------------
// El handler, uno solo
// ---------------------------------------------------------------------------

interface Indicador<T> {
  /** Nombre de la funcion SQL de 0002_estadisticas.sql. */
  funcion: string;
  /** true solo para las que reciben ademas p_agrupar. */
  agrupa?: boolean;
  /** Arma la forma de lib/tipos.ts con lo que haya devuelto la funcion. */
  normalizar: (dato: unknown) => T;
}

/**
 * Resuelve un indicador de punta a punta.
 *
 * Se usa clienteServidor(), nunca la clave de servicio: asi la consulta pasa
 * por RLS y cada usuario mide sobre lo que tiene permitido ver.
 */
export async function responderIndicador<T>(
  pedido: Request,
  indicador: Indicador<T>,
): Promise<Response> {
  // El middleware ya corta los pedidos sin sesion; se vuelve a pedir aca para
  // que la ruta no dependa de que el matcher la siga cubriendo.
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);

  const consulta = new URL(pedido.url).searchParams;
  const parametros: Record<string, unknown> = parametrosRPC(filtrosDeQuery(consulta));
  if (indicador.agrupa) parametros.p_agrupar = agrupacionDeQuery(consulta);

  const supabase = await clienteServidor();
  const { data, error: fallo } = await supabase.rpc(indicador.funcion, parametros);
  if (fallo) return errorDePostgres(fallo);

  return Response.json(indicador.normalizar(data));
}
