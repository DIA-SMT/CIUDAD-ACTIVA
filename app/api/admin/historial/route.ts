// /api/admin/historial - auditoria global de modificaciones (REQ 6).
//
// Las filas las escribe el trigger fn_auditar_registros, nunca la aplicacion:
// ningun camino puede modificar un registro sin dejar rastro. Aca solo se lee,
// paginado y de lo mas reciente a lo mas viejo, que es como se mira una
// auditoria cuando hay que explicar por que un numero cambio.

import { error, errorDePostgres, paginacionDeQuery } from '@/lib/consultas';
import { esFechaISO } from '@/lib/fechas';
import { clienteServidor, sesionActual, type Sesion } from '@/lib/supabase/servidor';
import { ETIQUETAS_CAMPOS } from '@/lib/validacion';
import type { AccionHistorial, EntradaHistorial, Pagina } from '@/lib/tipos';

/** Fila tal como sale de registros_historial. */
interface FilaHistorial {
  id: number;
  registro_id: number;
  accion: AccionHistorial;
  campo: string;
  valor_anterior: string;
  valor_nuevo: string;
  usuario_id: string | null;
  usuario_nombre: string;
  fecha_hora: string;
}

const COLUMNAS = 'id, registro_id, accion, campo, valor_anterior, valor_nuevo, ' +
  'usuario_id, usuario_nombre, fecha_hora';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tucuman esta en UTC-3 todo el ano: el pais no usa horario de verano, asi que
// el corte del dia se puede fijar sin mirar zonas horarias. Sin esto, filtrar
// "hasta hoy" se comeria las modificaciones hechas despues de las nueve de la
// noche, que es cuando los profesores cargan las clases de la tarde.
const DESFASE = '-03:00';

async function sesionAdmin(): Promise<Sesion | Response> {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);
  if (sesion.perfil.rol !== 'admin') {
    return error(
      'La auditoría es sólo para la administración del programa. Si necesitás saber ' +
      'quién modificó un registro, pedíselo a la Dirección.',
      403,
    );
  }
  return sesion;
}

export async function GET(pedido: Request) {
  const sesion = await sesionAdmin();
  if (sesion instanceof Response) return sesion;

  const sp = new URL(pedido.url).searchParams;

  // --- filtros del contrato -------------------------------------------------
  let registroId: number | null = null;
  const registroCrudo = sp.get('registro_id')?.trim();
  if (registroCrudo) {
    const n = Number(registroCrudo);
    if (!Number.isInteger(n) || n <= 0) {
      return error('El registro indicado no es válido.', 400);
    }
    registroId = n;
  }

  let usuarioId: string | null = null;
  const usuarioCrudo = sp.get('usuario_id')?.trim();
  if (usuarioCrudo) {
    if (!UUID.test(usuarioCrudo)) return error('El usuario indicado no es válido.', 400);
    usuarioId = usuarioCrudo;
  }

  let desde = sp.get('desde')?.trim() || null;
  let hasta = sp.get('hasta')?.trim() || null;
  if (desde && !esFechaISO(desde)) return error('La fecha «desde» no es válida.', 400);
  if (hasta && !esFechaISO(hasta)) return error('La fecha «hasta» no es válida.', 400);
  // Invertidas se ordenan, igual que en filtrosDeQuery: es un error de tipeo
  // frecuente y devolver cero resultados sin explicacion confunde mas que ayuda.
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];

  const supabase = await clienteServidor();

  /** Arma la consulta con los filtros aplicados. Se usa para contar y para leer. */
  const consulta = (columnas: string, opciones: { count?: 'exact'; head?: boolean } = {}) => {
    let c = supabase.from('registros_historial').select(columnas, opciones);
    if (registroId !== null) c = c.eq('registro_id', registroId);
    if (usuarioId !== null) c = c.eq('usuario_id', usuarioId);
    if (desde) c = c.gte('fecha_hora', `${desde}T00:00:00${DESFASE}`);
    if (hasta) c = c.lte('fecha_hora', `${hasta}T23:59:59.999${DESFASE}`);
    return c;
  };

  const { count, error: falloConteo } = await consulta('id', { count: 'exact', head: true });
  if (falloConteo) return errorDePostgres(falloConteo);

  const { pagina: pedida, porPagina } = paginacionDeQuery(sp);
  const total = count ?? 0;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  // Se acota antes de pedir el rango: un offset mas alla del total hace que
  // PostgREST conteste un error de rango en lugar de una pagina vacia.
  const pagina = Math.min(pedida, paginas);
  const primera = (pagina - 1) * porPagina;

  const { data, error: fallo } = await consulta(COLUMNAS)
    .order('fecha_hora', { ascending: false })
    .order('id', { ascending: false })
    .range(primera, primera + porPagina - 1)
    .returns<FilaHistorial[]>();

  if (fallo) return errorDePostgres(fallo);

  const datos: EntradaHistorial[] = (data ?? []).map((fila) => ({
    ...fila,
    // Nombre legible del campo tocado. En las altas y las bajas viene vacio:
    // el asiento es del registro entero, no de un campo.
    etiqueta_campo: fila.campo ? (ETIQUETAS_CAMPOS[fila.campo] ?? fila.campo) : '',
    usuario_nombre: fila.usuario_nombre.trim() || 'Sistema',
  }));

  const respuesta: Pagina<EntradaHistorial> = {
    datos,
    total,
    pagina,
    por_pagina: porPagina,
    paginas,
  };

  return Response.json(respuesta);
}
