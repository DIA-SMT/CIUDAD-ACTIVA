// /api/admin/lugares - listado y alta de espacios (REQ 3).
//
// Los lugares son un catalogo cerrado: el formulario de carga solo ofrece los
// activos y registros.lugar_id es clave foranea, asi que el nombre del espacio
// nunca se tipea a mano. Todo va con clienteServidor(), que hace correr las
// politicas RLS (lugares_admin exige rol admin para escribir).

import { error, errorDePostgres } from '@/lib/consultas';
import { clienteServidor, sesionActual, type Sesion } from '@/lib/supabase/servidor';
import type { Lugar } from '@/lib/tipos';

type ClienteServidor = Awaited<ReturnType<typeof clienteServidor>>;

/** Un lugar con el dato que el panel necesita antes de desactivarlo. */
interface LugarAdmin extends Lugar {
  registros: number;
}

const COLUMNAS = 'id, nombre, descripcion, activo, orden';
const LARGOS = { nombre: 120, descripcion: 400 } as const;
const ORDEN_MAX = 9999;

const texto = (v: unknown) => String(v ?? '').trim();

/** Entero de un cuerpo o de una query; null si no lo es. */
function entero(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * Todo /api/admin es de rol admin. RLS ya lo limita, pero cortar antes deja un
 * mensaje entendible en lugar de un error de permisos crudo.
 */
async function sesionAdmin(): Promise<Sesion | Response> {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);
  if (sesion.perfil.rol !== 'admin') {
    return error(
      'La gestión de lugares es sólo para la administración del programa. ' +
      'Si falta un espacio, pedíselo a la Dirección.',
      403,
    );
  }
  return sesion;
}

async function leerCuerpo(pedido: Request): Promise<Record<string, unknown> | null> {
  try {
    const cuerpo: unknown = await pedido.json();
    return cuerpo && typeof cuerpo === 'object' ? (cuerpo as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

/**
 * Clases registradas en el lugar. Se cuenta en la base con count exacto en vez
 * de traer las filas: PostgREST recorta la cantidad de filas que devuelve y un
 * conteo recortado seria un numero equivocado justo donde se decide una baja.
 */
async function contarRegistros(supabase: ClienteServidor, lugarId: number): Promise<number> {
  const { count } = await supabase
    .from('registros')
    .select('id', { count: 'exact', head: true })
    .eq('lugar_id', lugarId);
  return count ?? 0;
}

function validarAlta(cuerpo: Record<string, unknown>) {
  const errores: Record<string, string> = {};

  const nombre = texto(cuerpo.nombre);
  if (nombre.length < 2) {
    errores.nombre = 'Indicá el nombre del lugar.';
  } else if (nombre.length > LARGOS.nombre) {
    errores.nombre = `El nombre no puede superar los ${LARGOS.nombre} caracteres.`;
  }

  const descripcion = texto(cuerpo.descripcion);
  if (descripcion.length > LARGOS.descripcion) {
    errores.descripcion = `La descripción no puede superar los ${LARGOS.descripcion} caracteres.`;
  }

  const orden = entero(cuerpo.orden);
  if (cuerpo.orden !== undefined && cuerpo.orden !== null && cuerpo.orden !== '' && orden === null) {
    errores.orden = 'El orden tiene que ser un número entero.';
  } else if (orden !== null && (orden < 0 || orden > ORDEN_MAX)) {
    errores.orden = `El orden tiene que estar entre 0 y ${ORDEN_MAX}.`;
  }

  return { errores, datos: { nombre, descripcion, orden } };
}

// ---------------------------------------------------------------------------
// GET: todos, incluidos los inactivos. El panel necesita poder reactivarlos.
// ---------------------------------------------------------------------------
export async function GET() {
  const sesion = await sesionAdmin();
  if (sesion instanceof Response) return sesion;

  const supabase = await clienteServidor();

  const { data, error: fallo } = await supabase
    .from('lugares')
    .select(COLUMNAS)
    .order('activo', { ascending: false })
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })
    .returns<Lugar[]>();

  if (fallo) return errorDePostgres(fallo);

  const filas = data ?? [];
  // Un conteo por lugar: el catalogo es de una decena de espacios, asi que las
  // consultas salen en paralelo y el costo es despreciable.
  const lugares: LugarAdmin[] = await Promise.all(
    filas.map(async (lugar) => ({
      ...lugar,
      registros: await contarRegistros(supabase, lugar.id),
    })),
  );

  return Response.json({ lugares });
}

// ---------------------------------------------------------------------------
// POST: alta de un espacio.
// ---------------------------------------------------------------------------
export async function POST(pedido: Request) {
  const sesion = await sesionAdmin();
  if (sesion instanceof Response) return sesion;

  const cuerpo = await leerCuerpo(pedido);
  if (!cuerpo) return error('El cuerpo del pedido no es un JSON válido.', 400);

  const { errores, datos } = validarAlta(cuerpo);
  if (Object.keys(errores).length > 0) {
    return error('Revisá los datos del lugar.', 422, { errores });
  }

  const supabase = await clienteServidor();

  // El unique de la base distingue mayusculas de minusculas, asi que la
  // comparacion se hace aca sin distinguirlas: si no, 'Plaza Urquiza' y 'plaza
  // urquiza' entrarian como dos espacios distintos. El catalogo es de una
  // decena de filas, traerlo entero sale mas barato que una consulta por nombre.
  const { data: existentes, error: falloLectura } = await supabase
    .from('lugares')
    .select('id, nombre, activo, orden')
    .returns<Pick<Lugar, 'id' | 'nombre' | 'activo' | 'orden'>[]>();

  if (falloLectura) return errorDePostgres(falloLectura);

  const repetido = (existentes ?? []).find(
    (l) => l.nombre.trim().toLowerCase() === datos.nombre.toLowerCase(),
  );

  if (repetido) {
    const extra = repetido.activo
      ? ''
      : ' Ese lugar está desactivado: podés volver a activarlo en lugar de crear otro.';
    return error(`Ya existe un lugar llamado «${repetido.nombre}».${extra}`, 409);
  }

  // Sin orden explicito, el lugar nuevo va al final del desplegable.
  const ultimo = (existentes ?? []).reduce((max, l) => Math.max(max, l.orden), 0);
  const orden = datos.orden ?? ultimo + 1;

  const { data: lugar, error: fallo } = await supabase
    .from('lugares')
    .insert({
      nombre: datos.nombre,
      descripcion: datos.descripcion,
      orden,
      activo: true,
    })
    .select(COLUMNAS)
    .single<Lugar>();

  if (fallo) return errorDePostgres(fallo);

  const nuevo: LugarAdmin = { ...lugar, registros: 0 };

  return Response.json({ lugar: nuevo }, { status: 201 });
}
