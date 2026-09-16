// Un registro puntual: consulta (REQ 5), edicion y baja (REQ 6).
//
// Los permisos no se deciden aca: los aplica RLS sobre la tabla registros. Este
// modulo solo traduce el resultado. Si un UPDATE o un DELETE afecta cero filas
// es porque la politica lo bloqueo, y eso se devuelve como 403 explicando el
// motivo probable en lugar de un 200 silencioso que haria creer que se guardo.

import { error, errorDePostgres } from '@/lib/consultas';
import { fmt } from '@/lib/fechas';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';
import { validarRegistro } from '@/lib/validacion';
import type {
  Catalogos,
  CuerpoRegistro,
  EstadoClase,
  Lugar,
  ProfesorOpcion,
  Registro,
} from '@/lib/tipos';

type Cliente = Awaited<ReturnType<typeof clienteServidor>>;

/** En Next 16 los params de una ruta dinamica llegan como Promise. */
type Contexto = { params: Promise<{ id: string }> };

const VENTANA_POR_DEFECTO = 7;

const esVerdadero = (valor: unknown): boolean =>
  valor === true || valor === 'true' || valor === 1 || valor === '1';

/** Id de la URL. Devuelve null si no es un entero positivo. */
function idDeParam(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Deja el valor guardado cuando el cuerpo no trae el campo. */
function elegir<T>(pedido: T | null | undefined, guardado: T): T {
  return pedido === null || pedido === undefined ? guardado : pedido;
}

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

/** Plazo de edicion del REQ 6. Vive en parametros para no redesplegar al cambiarlo. */
async function ventanaEdicionDias(supabase: Cliente): Promise<number> {
  const { data } = await supabase
    .from('parametros')
    .select('valor')
    .eq('clave', 'ventana_edicion_dias')
    .maybeSingle<{ valor: string }>();

  const dias = Number(data?.valor);
  return Number.isInteger(dias) && dias > 0 ? dias : VENTANA_POR_DEFECTO;
}

const leerRegistro = async (supabase: Cliente, id: number) =>
  supabase.from('v_registros').select('*').eq('id', id).maybeSingle<Registro>();

const NO_ESTA =
  'No encontramos el registro que buscás. Puede que ya se haya eliminado.';

function avisoDuplicados(duplicados: Registro[]): string {
  const primero = duplicados[0];
  const cuantos =
    duplicados.length === 1
      ? 'Ya hay otro registro cargado'
      : `Ya hay otros ${duplicados.length} registros cargados`;

  return (
    `${cuantos} para el ${fmt.fecha(primero.fecha)} en ${primero.lugar_nombre} ` +
    `con ${primero.profesor_nombre}. Si de verdad se dictó otra clase, ` +
    'confirmá para guardar el cambio igual.'
  );
}

// ---------------------------------------------------------------------------
// GET — un registro
// ---------------------------------------------------------------------------

export async function GET(pedido: Request, { params }: Contexto) {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);

  const id = idDeParam((await params).id);
  if (!id) return error('El identificador del registro no es válido.', 400);

  const supabase = await clienteServidor();
  const { data: registro, error: fallo } = await leerRegistro(supabase, id);

  if (fallo) return errorDePostgres(fallo);
  if (!registro) return error(NO_ESTA, 404);

  return Response.json({ registro });
}

// ---------------------------------------------------------------------------
// PATCH — edicion (REQ 6)
// ---------------------------------------------------------------------------

export async function PATCH(pedido: Request, { params }: Contexto) {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);

  const id = idDeParam((await params).id);
  if (!id) return error('El identificador del registro no es válido.', 400);

  let crudo: unknown;
  try {
    crudo = await pedido.json();
  } catch {
    return error('No pudimos leer los datos del pedido. Volvé a intentar.', 400);
  }
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) {
    return error('El pedido tiene que traer los campos a modificar.', 400);
  }
  const cuerpo = crudo as Partial<CuerpoRegistro>;

  const supabase = await clienteServidor();

  const { data: actual, error: falloLectura } = await leerRegistro(supabase, id);
  if (falloLectura) return errorDePostgres(falloLectura);
  if (!actual) return error(NO_ESTA, 404);

  const { catalogos, fallo: falloCatalogos } = await catalogosVigentes(supabase);
  if (falloCatalogos) return errorDePostgres(falloCatalogos);

  // Un correo en blanco se toma como "no lo mandes cambiar", no como borrarlo.
  const correo = String(cuerpo.email_responsable ?? '').trim();

  // Lo que no venga en el cuerpo conserva el valor guardado: una pantalla que
  // solo corrige las observaciones no tiene que reenviar todo el registro.
  const { valido, errores, datos } = validarRegistro(
    {
      fecha: elegir(cuerpo.fecha, actual.fecha),
      profesor_id: elegir(cuerpo.profesor_id, actual.profesor_id),
      lugar_id: elegir(cuerpo.lugar_id, actual.lugar_id),
      estado_codigo: elegir(cuerpo.estado_codigo, actual.estado_codigo),
      alumnos_total: elegir(cuerpo.alumnos_total, actual.alumnos_total),
      alumnos_nuevos: elegir(cuerpo.alumnos_nuevos, actual.alumnos_nuevos),
      varones: elegir(cuerpo.varones, actual.varones),
      mujeres: elegir(cuerpo.mujeres, actual.mujeres),
      observaciones: elegir(cuerpo.observaciones, actual.observaciones),
      email_responsable: correo || actual.email_responsable,
    },
    catalogos,
  );

  if (!valido || !datos) {
    return error('Revisá los datos marcados y volvé a intentar.', 422, { errores });
  }

  const moviaLaClave =
    datos.fecha !== actual.fecha ||
    datos.profesor_id !== actual.profesor_id ||
    datos.lugar_id !== actual.lugar_id;

  // Solo se avisa si la edicion lleva el registro a una combinacion ya ocupada.
  // Si la fecha, el profesor y el lugar no cambian, el duplicado que pudiera
  // existir ya se confirmo en su momento y no hay que volver a preguntar.
  if (moviaLaClave && !esVerdadero(cuerpo.confirmar_duplicado)) {
    const { data: duplicados, error: falloDup } = await supabase
      .from('v_registros')
      .select('*')
      .eq('fecha', datos.fecha)
      .eq('profesor_id', datos.profesor_id)
      .eq('lugar_id', datos.lugar_id)
      .neq('id', id)
      .order('id', { ascending: true })
      .returns<Registro[]>();

    if (falloDup) return errorDePostgres(falloDup);

    if (duplicados && duplicados.length > 0) {
      return error(avisoDuplicados(duplicados), 409, { duplicados });
    }
  }

  const hayCambios =
    moviaLaClave ||
    datos.estado_codigo !== actual.estado_codigo ||
    datos.alumnos_total !== actual.alumnos_total ||
    datos.alumnos_nuevos !== actual.alumnos_nuevos ||
    datos.varones !== actual.varones ||
    datos.mujeres !== actual.mujeres ||
    datos.observaciones !== actual.observaciones ||
    datos.email_responsable !== actual.email_responsable;

  // Sin cambios reales no se toca la base: escribir actualizado_en de gusto
  // ensuciaria la auditoria del REQ 6 con un asiento que no dice nada.
  if (!hayCambios) return Response.json({ registro: actual });

  const { data: modificados, error: falloEdicion } = await supabase
    .from('registros')
    .update(datos)
    .eq('id', id)
    .select('id')
    .returns<{ id: number }[]>();

  if (falloEdicion) {
    // La politica dejo leer la fila pero rechazo el valor nuevo: el caso tipico
    // es un profesor intentando pasarle el registro a otro.
    if (falloEdicion.code === '42501') {
      return error(
        'No podés guardar este cambio. Un profesor sólo puede corregir sus ' +
        'propios registros y no puede pasarlos a nombre de otro. Pedile el ' +
        'cambio a un administrador de la Dirección.',
        403,
      );
    }
    return errorDePostgres(falloEdicion);
  }

  if (!modificados || modificados.length === 0) {
    // Cero filas afectadas sobre un registro que existe = RLS lo bloqueo.
    const dias = await ventanaEdicionDias(supabase);
    return error(
      `No se pudo modificar el registro de la clase del ${fmt.fecha(actual.fecha)}. ` +
      `Un profesor tiene ${dias} días desde la fecha de la clase para corregir ` +
      'su propia carga; pasado ese plazo, o si la clase figura a nombre de otro ' +
      'profesor, el cambio lo tiene que hacer un administrador. Pedíselo a la ' +
      'Dirección de Deportes y Recreación.',
      403,
    );
  }

  // El asiento por campo modificado lo escribe el trigger, no este codigo.

  const { data: registro, error: falloFinal } = await leerRegistro(supabase, id);
  if (falloFinal) return errorDePostgres(falloFinal);

  return Response.json({ registro });
}

// ---------------------------------------------------------------------------
// DELETE — baja (RLS la limita a administradores)
// ---------------------------------------------------------------------------

export async function DELETE(pedido: Request, { params }: Contexto) {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);

  const id = idDeParam((await params).id);
  if (!id) return error('El identificador del registro no es válido.', 400);

  const supabase = await clienteServidor();

  // Se lee primero para poder distinguir "no existe" (404) de "no te deja"
  // (403): el DELETE bloqueado por RLS tambien devuelve cero filas.
  const { data: actual, error: falloLectura } = await leerRegistro(supabase, id);
  if (falloLectura) return errorDePostgres(falloLectura);
  if (!actual) return error(NO_ESTA, 404);

  const { data: borrados, error: falloBaja } = await supabase
    .from('registros')
    .delete()
    .eq('id', id)
    .select('id')
    .returns<{ id: number }[]>();

  if (falloBaja) {
    if (falloBaja.code === '42501') {
      return error(
        'Sólo un administrador puede eliminar registros. Si cargaste algo por ' +
        'error, pedí la baja a la Dirección de Deportes y Recreación.',
        403,
      );
    }
    return errorDePostgres(falloBaja);
  }

  if (!borrados || borrados.length === 0) {
    return error(
      'Sólo un administrador puede eliminar registros. Si cargaste algo por ' +
      'error, pedí la baja a la Dirección de Deportes y Recreación.',
      403,
    );
  }

  // La baja queda asentada en registros_historial por el trigger, y ese
  // historial sobrevive al registro: es lo que pide el REQ 6.
  return Response.json({ ok: true });
}
