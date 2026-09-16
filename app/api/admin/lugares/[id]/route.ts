// /api/admin/lugares/[id] - edicion de un espacio (REQ 3).
//
// Aca tampoco se elimina nada: un lugar con clases cargadas se desactiva, nunca
// se borra, para no romper el historico del REQ 5 ni descuadrar los indicadores
// del REQ 7. Cuando la baja deja registros colgando, la respuesta dice cuantos.

import { error, errorDePostgres } from '@/lib/consultas';
import { clienteServidor, sesionActual, type Sesion } from '@/lib/supabase/servidor';
import type { Lugar } from '@/lib/tipos';

type ClienteServidor = Awaited<ReturnType<typeof clienteServidor>>;

interface LugarAdmin extends Lugar {
  registros: number;
}

const COLUMNAS = 'id, nombre, descripcion, activo, orden';
const LARGOS = { nombre: 120, descripcion: 400 } as const;
const ORDEN_MAX = 9999;

const texto = (v: unknown) => String(v ?? '').trim();

function entero(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function bandera(valor: unknown, porDefecto: boolean): boolean {
  if (valor === undefined || valor === null || valor === '') return porDefecto;
  if (typeof valor === 'boolean') return valor;
  const s = String(valor).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'si' || s === 'sí') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return porDefecto;
}

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

async function contarRegistros(supabase: ClienteServidor, lugarId: number): Promise<number> {
  const { count } = await supabase
    .from('registros')
    .select('id', { count: 'exact', head: true })
    .eq('lugar_id', lugarId);
  return count ?? 0;
}

/** REQ 5: la baja no borra, asi que se avisa cuanto historico queda atado. */
function avisoBaja(registros: number): string {
  const base = 'El lugar quedó desactivado: ya no se ofrece en el formulario de carga.';
  if (registros === 0) return base;
  const quedan = registros === 1
    ? 'Queda 1 registro asociado, que se conserva en el histórico.'
    : `Quedan ${registros} registros asociados, que se conservan en el histórico.`;
  return `${base} ${quedan}`;
}

/** Mezcla el cuerpo con el lugar actual: lo que no viene, no cambia. */
function armarCambios(cuerpo: Record<string, unknown>, actual: Lugar) {
  const errores: Record<string, string> = {};

  const nombre = cuerpo.nombre === undefined ? actual.nombre : texto(cuerpo.nombre);
  if (nombre.length < 2) {
    errores.nombre = 'Indicá el nombre del lugar.';
  } else if (nombre.length > LARGOS.nombre) {
    errores.nombre = `El nombre no puede superar los ${LARGOS.nombre} caracteres.`;
  }

  const descripcion = cuerpo.descripcion === undefined
    ? actual.descripcion
    : texto(cuerpo.descripcion);
  if (descripcion.length > LARGOS.descripcion) {
    errores.descripcion = `La descripción no puede superar los ${LARGOS.descripcion} caracteres.`;
  }

  let orden = entero(cuerpo.orden);
  if (cuerpo.orden !== undefined && cuerpo.orden !== null && cuerpo.orden !== '' && orden === null) {
    errores.orden = 'El orden tiene que ser un número entero.';
  } else if (orden !== null && (orden < 0 || orden > ORDEN_MAX)) {
    errores.orden = `El orden tiene que estar entre 0 y ${ORDEN_MAX}.`;
  }
  if (orden === null) orden = actual.orden;

  return {
    errores,
    datos: { nombre, descripcion, orden, activo: bandera(cuerpo.activo, actual.activo) },
  };
}

export async function PATCH(pedido: Request, contexto: { params: Promise<{ id: string }> }) {
  const sesion = await sesionAdmin();
  if (sesion instanceof Response) return sesion;

  const { id: crudo } = await contexto.params;
  const id = entero(crudo);
  if (id === null || id <= 0) return error('El identificador del lugar no es válido.', 400);

  const cuerpo = await leerCuerpo(pedido);
  if (!cuerpo) return error('El cuerpo del pedido no es un JSON válido.', 400);

  const supabase = await clienteServidor();

  const { data: actual, error: falloLectura } = await supabase
    .from('lugares')
    .select(COLUMNAS)
    .eq('id', id)
    .maybeSingle<Lugar>();

  if (falloLectura) return errorDePostgres(falloLectura);
  if (!actual) return error('No encontramos el lugar que querés editar.', 404);

  const { errores, datos } = armarCambios(cuerpo, actual);
  if (Object.keys(errores).length > 0) {
    return error('Revisá los datos del lugar.', 422, { errores });
  }

  // El unique de la base distingue mayusculas de minusculas, asi que la
  // comparacion se hace aca sin distinguirlas: si no, quedarian dos espacios
  // que en pantalla se leen igual. Solo hace falta si el nombre cambio.
  if (datos.nombre.toLowerCase() !== actual.nombre.trim().toLowerCase()) {
    const { data: otros, error: falloOtros } = await supabase
      .from('lugares')
      .select('id, nombre, activo')
      .neq('id', id)
      .returns<Pick<Lugar, 'id' | 'nombre' | 'activo'>[]>();

    if (falloOtros) return errorDePostgres(falloOtros);

    const repetido = (otros ?? []).find(
      (l) => l.nombre.trim().toLowerCase() === datos.nombre.toLowerCase(),
    );

    if (repetido) {
      const extra = repetido.activo
        ? ''
        : ' Ese lugar está desactivado: podés volver a activarlo en lugar de renombrar éste.';
      return error(`Ya existe un lugar llamado «${repetido.nombre}».${extra}`, 409);
    }
  }

  const { data: lugar, error: fallo } = await supabase
    .from('lugares')
    .update({
      nombre: datos.nombre,
      descripcion: datos.descripcion,
      orden: datos.orden,
      activo: datos.activo,
    })
    .eq('id', id)
    .select(COLUMNAS)
    .maybeSingle<Lugar>();

  if (fallo) return errorDePostgres(fallo);
  // Sin filas afectadas es RLS: la politica lugares_admin la bloqueo.
  if (!lugar) return error('No tenés permiso para modificar este lugar.', 403);

  const registros = await contarRegistros(supabase, lugar.id);
  const seDesactivo = actual.activo && !lugar.activo;

  const actualizado: LugarAdmin = { ...lugar, registros };

  return Response.json({
    lugar: actualizado,
    registros_asociados: registros,
    aviso: seDesactivo ? avisoBaja(registros) : null,
  });
}
