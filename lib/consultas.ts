// Los filtros del REQ 8, definidos una sola vez.
//
// El listado y todos los indicadores leen los filtros de acá. Si cada uno los
// interpretara por su cuenta, el tablero podría contar un conjunto de clases y
// la tabla mostrar otro, que es la peor falla posible en un sistema que se usa
// para informar.

import { esFechaISO } from './fechas';
import type { Filtros } from './tipos';

export const ORDENES = {
  fecha_desc: { columna: 'fecha', asc: false },
  fecha_asc: { columna: 'fecha', asc: true },
  alumnos_desc: { columna: 'alumnos_total', asc: false },
  creado_desc: { columna: 'creado_en', asc: false },
} as const;

export type ClaveOrden = keyof typeof ORDENES;

export const POR_PAGINA_DEFECTO = 25;
export const POR_PAGINA_MAX = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lee los filtros del REQ 8, descartando en silencio lo que no sea válido. */
export function filtrosDeQuery(sp: URLSearchParams): Filtros {
  const f: Filtros = {};

  const desde = sp.get('desde');
  const hasta = sp.get('hasta');
  if (desde && esFechaISO(desde)) f.desde = desde;
  if (hasta && esFechaISO(hasta)) f.hasta = hasta;
  // Si vienen invertidas, se ordenan: es un error de tipeo frecuente y
  // devolver cero resultados sin explicación confunde más que ayudar.
  if (f.desde && f.hasta && f.desde > f.hasta) {
    [f.desde, f.hasta] = [f.hasta, f.desde];
  }

  const profesor = sp.get('profesor_id');
  if (profesor && UUID.test(profesor)) f.profesor_id = profesor;

  const lugar = Number(sp.get('lugar_id'));
  if (Number.isInteger(lugar) && lugar > 0) f.lugar_id = lugar;

  const estado = sp.get('estado')?.trim();
  if (estado) f.estado = estado;

  const q = sp.get('q')?.trim();
  if (q) f.q = q.slice(0, 120);

  return f;
}

/** Parámetros con los que se llaman las funciones SQL de estadísticas. */
export function parametrosRPC(f: Filtros) {
  return {
    p_desde: f.desde ?? null,
    p_hasta: f.hasta ?? null,
    p_profesor: f.profesor_id ?? null,
    p_lugar: f.lugar_id ?? null,
    p_estado: f.estado ?? null,
    p_q: f.q ?? null,
  };
}

/**
 * Aplica los filtros a una consulta de PostgREST sobre v_registros.
 * Tipado laxo a propósito: el encadenado de filtros de supabase-js devuelve un
 * tipo distinto en cada paso y fijarlo acá no aporta seguridad real.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function aplicarFiltros<T extends { [k: string]: any }>(consulta: T, f: Filtros): T {
  let c = consulta;
  if (f.desde) c = c.gte('fecha', f.desde);
  if (f.hasta) c = c.lte('fecha', f.hasta);
  if (f.profesor_id) c = c.eq('profesor_id', f.profesor_id);
  if (f.lugar_id) c = c.eq('lugar_id', f.lugar_id);
  if (f.estado) c = c.eq('estado_codigo', f.estado);
  if (f.q) {
    // Las comas y los paréntesis rompen la sintaxis de .or() de PostgREST.
    const t = f.q.replace(/[,()]/g, ' ').trim();
    if (t) {
      c = c.or(
        `observaciones.ilike.*${t}*,profesor_nombre.ilike.*${t}*,lugar_nombre.ilike.*${t}*`,
      );
    }
  }
  return c;
}

/** Paginación con los topes del contrato. */
export function paginacionDeQuery(sp: URLSearchParams) {
  const pagina = Math.max(1, Number(sp.get('pagina')) || 1);
  const pedido = Number(sp.get('por_pagina')) || POR_PAGINA_DEFECTO;
  const porPagina = Math.min(POR_PAGINA_MAX, Math.max(1, pedido));
  return { pagina, porPagina, desde: (pagina - 1) * porPagina, hasta: pagina * porPagina - 1 };
}

/** Orden validado contra la lista blanca. Cualquier otro valor cae al defecto. */
export function ordenDeQuery(sp: URLSearchParams, defecto: ClaveOrden = 'fecha_desc') {
  const clave = sp.get('orden') as ClaveOrden | null;
  return ORDENES[clave && clave in ORDENES ? clave : defecto];
}

/** Respuesta de error uniforme. */
export function error(mensaje: string, estado = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: mensaje, ...extra }, { status: estado });
}

/**
 * Traduce un error de Postgres a una respuesta con sentido para el usuario.
 * Los CHECK del REQ 4 llegan acá cuando alguien esquiva el formulario.
 */
export function errorDePostgres(e: { code?: string; message?: string } | null) {
  const codigo = e?.code ?? '';
  const texto = e?.message ?? '';

  if (codigo === '42501') {
    return error(
      'No tenés permiso para esta operación. Si es un registro tuyo, puede que ' +
      'haya vencido el plazo para modificarlo.',
      403,
    );
  }

  if (codigo === '23514') {
    if (texto.includes('ck_suma_sexos')) {
      return Response.json({
        error: 'Los números no cierran.',
        errores: {
          alumnos_total: 'La suma de varones y mujeres tiene que dar el total de alumnos.',
        },
      }, { status: 422 });
    }
    if (texto.includes('ck_nuevos_en_total')) {
      return Response.json({
        error: 'Los números no cierran.',
        errores: { alumnos_nuevos: 'Los alumnos nuevos no pueden superar el total.' },
      }, { status: 422 });
    }
    if (texto.includes('ck_sin_futuro')) {
      return Response.json({
        error: 'La fecha no es válida.',
        errores: { fecha: 'No se pueden cargar clases con fecha futura.' },
      }, { status: 422 });
    }
    if (texto.includes('ck_no_negativos')) {
      return Response.json({
        error: 'Los números no son válidos.',
        errores: { alumnos_total: 'Las cantidades no pueden ser negativas.' },
      }, { status: 422 });
    }
    return error('Los datos no cumplen una regla de validación.', 422);
  }

  if (codigo === '23505') return error('Ya existe un registro con esos datos.', 409);
  if (codigo === '23503') return error('El profesor o el lugar seleccionado no existe.', 422);
  if (codigo === 'PGRST116') return error('No se encontró el registro.', 404);

  console.error('[ciudad-activa] error de base:', codigo, texto);
  return error('Ocurrió un error al procesar el pedido. Intentá de nuevo.', 500);
}
