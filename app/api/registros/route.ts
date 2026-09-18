// REQ 1, 5 y 8: alta de una actividad y listado historico consultable.
//
// Todo lo que se devuelve sale de la vista v_revision filtrada con
// filtrosDeQuery() + aplicarFiltros(), que son las mismas funciones que usan los
// indicadores del REQ 7: asi el listado y el tablero nunca pueden mirar
// subconjuntos distintos.

import {
  aplicarFiltros,
  error,
  errorDePostgres,
  filtrosDeQuery,
  ordenDeQuery,
  paginacionDeQuery,
} from '@/lib/consultas';
import { fmt } from '@/lib/fechas';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';
import { validarRegistro } from '@/lib/validacion';
import type {
  Catalogos,
  CuerpoRegistro,
  EstadoClase,
  Lugar,
  Pagina,
  ProfesorOpcion,
  Registro,
} from '@/lib/tipos';

type Cliente = Awaited<ReturnType<typeof clienteServidor>>;

/** El formulario puede mandar el booleano como texto. */
const esVerdadero = (valor: unknown): boolean =>
  valor === true || valor === 'true' || valor === 1 || valor === '1';

/**
 * Catalogos vigentes para validarRegistro(): los autorizados del REQ 2 y los
 * espacios del REQ 3, solo activos. Se leen de la base en cada alta para que un
 * formulario con datos viejos en pantalla no pueda grabar contra una baja.
 */
async function catalogosVigentes(supabase: Cliente) {
  const [profesores, lugares, estados] = await Promise.all([
    supabase
      .from('perfiles')
      .select('id, nombre, cargo, email')
      .eq('activo', true)
      .eq('dicta_clases', true)
      .order('nombre', { ascending: true })
      .returns<ProfesorOpcion[]>(),
    supabase
      .from('lugares')
      .select('id, nombre')
      .eq('activo', true)
      .order('orden', { ascending: true })
      .returns<Pick<Lugar, 'id' | 'nombre'>[]>(),
    supabase
      .from('estados_clase')
      .select('codigo, nombre, es_suspension')
      .eq('activo', true)
      .order('orden', { ascending: true })
      .returns<Pick<EstadoClase, 'codigo' | 'nombre' | 'es_suspension'>[]>(),
  ]);

  const catalogos: Catalogos = {
    profesores: profesores.data ?? [],
    lugares: lugares.data ?? [],
    estados: estados.data ?? [],
  };

  return { catalogos, fallo: profesores.error ?? lugares.error ?? estados.error };
}

/** Mensaje del 409: dice exactamente que clase ya estaba cargada. */
function avisoDuplicados(duplicados: Registro[]): string {
  const primero = duplicados[0];
  const cuantos =
    duplicados.length === 1
      ? 'Ya hay un registro cargado'
      : `Ya hay ${duplicados.length} registros cargados`;

  return (
    `${cuantos} para el ${fmt.fecha(primero.fecha)} en ${primero.lugar_nombre} ` +
    `con ${primero.profesor_nombre}. Si de verdad se dictó otra clase, ` +
    'confirmá para guardarla igual.'
  );
}

// ---------------------------------------------------------------------------
// GET — listado paginado (REQ 5 y REQ 8)
// ---------------------------------------------------------------------------

export async function GET(pedido: Request) {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);

  const sp = new URL(pedido.url).searchParams;
  const filtros = filtrosDeQuery(sp);
  const orden = ordenDeQuery(sp);
  const { pagina, porPagina, desde, hasta } = paginacionDeQuery(sp);

  const supabase = await clienteServidor();

  const armarPagina = (datos: Registro[], total: number): Pagina<Registro> => ({
    datos,
    total,
    pagina,
    por_pagina: porPagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
  });

  const { data, count, error: fallo } = await aplicarFiltros(
    supabase.from('v_revision').select('*', { count: 'exact' }),
    filtros,
  )
    .order(orden.columna, { ascending: orden.asc })
    // Desempate por id: sin un orden total, dos paginas consecutivas podrian
    // repetir o saltear filas con la misma fecha.
    .order('id', { ascending: orden.asc })
    .range(desde, hasta)
    .returns<Registro[]>();

  if (fallo) {
    // PostgREST contesta 416 cuando la pagina pedida arranca despues de la
    // ultima fila. Pasa al aplicar un filtro estando parado en una pagina alta:
    // eso es una pagina vacia, no un error, y conviene devolver el total para
    // que la pantalla pueda volver a una pagina que exista.
    if (fallo.code === 'PGRST103') {
      const { count: totalReal } = await aplicarFiltros(
        supabase.from('v_revision').select('*', { count: 'exact', head: true }),
        filtros,
      );
      return Response.json(armarPagina([], totalReal ?? 0));
    }
    return errorDePostgres(fallo);
  }

  return Response.json(armarPagina(data ?? [], count ?? 0));
}

// ---------------------------------------------------------------------------
// POST — alta (REQ 1 y REQ 4)
// ---------------------------------------------------------------------------

export async function POST(pedido: Request) {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);

  let crudo: unknown;
  try {
    crudo = await pedido.json();
  } catch {
    return error('No pudimos leer los datos del pedido. Volvé a intentar.', 400);
  }
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) {
    return error('El pedido tiene que traer los datos de la clase.', 400);
  }
  const cuerpo = crudo as Partial<CuerpoRegistro>;

  const supabase = await clienteServidor();
  const { catalogos, fallo } = await catalogosVigentes(supabase);
  if (fallo) return errorDePostgres(fallo);

  const esAdmin = sesion.perfil.rol === 'admin';
  const profesorPedido = String(cuerpo.profesor_id ?? '').trim();

  const { valido, errores, datos } = validarRegistro(
    {
      ...cuerpo,
      // El profesor que no elige a nadie carga a su nombre. Al administrador se
      // lo deja vacio a proposito: puede cargar por cualquiera, asi que tiene
      // que elegir explicitamente de quien es la clase.
      profesor_id: profesorPedido || (esAdmin ? '' : sesion.usuarioId),
      email_responsable:
        String(cuerpo.email_responsable ?? '').trim() || sesion.perfil.email,
    },
    catalogos,
  );

  if (!valido || !datos) {
    return error('Revisá los datos marcados y volvé a intentar.', 422, { errores });
  }

  // REQ 1: hay dias con dos clases reales del mismo profesor en el mismo lugar,
  // por eso el duplicado se avisa y se confirma, no se bloquea.
  if (!esVerdadero(cuerpo.confirmar_duplicado)) {
    const { data: duplicados, error: falloDup } = await supabase
      .from('v_revision')
      .select('*')
      .eq('fecha', datos.fecha)
      .eq('profesor_id', datos.profesor_id)
      .eq('lugar_id', datos.lugar_id)
      .order('id', { ascending: true })
      .returns<Registro[]>();

    if (falloDup) return errorDePostgres(falloDup);

    if (duplicados && duplicados.length > 0) {
      return error(avisoDuplicados(duplicados), 409, { duplicados });
    }
  }

  const { data: alta, error: falloAlta } = await supabase
    .from('registros')
    .insert({ ...datos, cargado_por: sesion.usuarioId, origen: 'web' })
    .select('id')
    .single<{ id: number }>();

  if (falloAlta) {
    // RLS: un profesor solo puede cargar a su nombre.
    if (falloAlta.code === '42501') {
      return error(
        'Sólo podés cargar clases a tu nombre. Para cargar en nombre de otro ' +
        'profesor, pedíselo a un administrador de la Dirección.',
        403,
      );
    }
    return errorDePostgres(falloAlta);
  }

  // El historial del REQ 6 lo escribe el trigger fn_auditar_registros. Si se
  // asentara tambien desde aca, cada alta quedaria duplicada en la auditoria.

  const { data: registro, error: falloLectura } = await supabase
    .from('v_revision')
    .select('*')
    .eq('id', alta.id)
    .maybeSingle<Registro>();

  if (falloLectura) return errorDePostgres(falloLectura);

  return Response.json({ registro }, { status: 201 });
}
