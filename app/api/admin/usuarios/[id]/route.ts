// /api/admin/usuarios/[id] - edicion de un usuario (REQ 2 y REQ 6).
//
// Aca no se elimina nada: un usuario con clases cargadas se desactiva, nunca se
// borra, para no romper el historico del REQ 5 ni descuadrar los indicadores del
// REQ 7. Cuando la baja deja registros colgando, la respuesta dice cuantos son.
//
// Los dos resguardos de acceso -no desactivarse a si mismo, no dejar el sistema
// sin administradores- se comprueban contra la base antes de tocar nada.

import { error, errorDePostgres } from '@/lib/consultas';
import { clienteServidor, sesionActual, type Sesion } from '@/lib/supabase/servidor';
import type { Perfil, Rol } from '@/lib/tipos';

type ClienteServidor = Awaited<ReturnType<typeof clienteServidor>>;

interface UsuarioAdmin extends Perfil {
  registros: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: readonly Rol[] = ['profesor', 'admin'];
const LARGOS = { nombre: 120, cargo: 80 } as const;

const texto = (v: unknown) => String(v ?? '').trim();

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
      'La gestión de usuarios es sólo para la administración del programa. ' +
      'Si necesitás un cambio, pedíselo a la Dirección.',
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

async function contarRegistros(supabase: ClienteServidor, profesorId: string): Promise<number> {
  const { count } = await supabase
    .from('registros')
    .select('id', { count: 'exact', head: true })
    .eq('profesor_id', profesorId);
  return count ?? 0;
}

/** REQ 5: la baja no borra, asi que se avisa cuanto historico queda atado. */
function avisoBaja(registros: number): string {
  const base = 'El usuario quedó desactivado: ya no puede ingresar ni aparece en el ' +
    'listado de profesores autorizados.';
  if (registros === 0) return base;
  const quedan = registros === 1
    ? 'Queda 1 registro asociado, que se conserva en el histórico.'
    : `Quedan ${registros} registros asociados, que se conservan en el histórico.`;
  return `${base} ${quedan}`;
}

/** Mezcla el cuerpo con el perfil actual: lo que no viene, no cambia. */
function armarCambios(cuerpo: Record<string, unknown>, actual: Perfil) {
  const errores: Record<string, string> = {};

  const nombre = cuerpo.nombre === undefined ? actual.nombre : texto(cuerpo.nombre);
  if (nombre.length < 2) {
    errores.nombre = 'Escribí el nombre y el apellido del usuario.';
  } else if (nombre.length > LARGOS.nombre) {
    errores.nombre = `El nombre no puede superar los ${LARGOS.nombre} caracteres.`;
  }

  const cargo = (cuerpo.cargo === undefined ? actual.cargo : texto(cuerpo.cargo)) || 'Profesor';
  if (cargo.length > LARGOS.cargo) {
    errores.cargo = `El cargo no puede superar los ${LARGOS.cargo} caracteres.`;
  }

  const rol = (
    cuerpo.rol === undefined ? actual.rol : texto(cuerpo.rol).toLowerCase()
  ) as Rol;
  if (!ROLES.includes(rol)) errores.rol = 'El rol tiene que ser «profesor» o «admin».';

  // El correo es la identidad de la cuenta en Supabase Auth: cambiarlo aca
  // dejaria el perfil y el ingreso apuntando a direcciones distintas.
  if (cuerpo.email !== undefined && texto(cuerpo.email).toLowerCase() !== actual.email) {
    errores.email = 'El correo no se puede cambiar: es con el que la persona ingresa. ' +
      'Si cambió de dirección, dá de baja esta cuenta y creá una nueva.';
  }

  return {
    errores,
    datos: {
      nombre,
      cargo,
      rol,
      dicta_clases: bandera(cuerpo.dicta_clases, actual.dicta_clases),
      activo: bandera(cuerpo.activo, actual.activo),
    },
  };
}

export async function PATCH(pedido: Request, contexto: { params: Promise<{ id: string }> }) {
  const sesion = await sesionAdmin();
  if (sesion instanceof Response) return sesion;

  const { id } = await contexto.params;
  if (!UUID.test(id)) return error('El identificador del usuario no es válido.', 400);

  const cuerpo = await leerCuerpo(pedido);
  if (!cuerpo) return error('El cuerpo del pedido no es un JSON válido.', 400);

  const supabase = await clienteServidor();

  const { data: actual, error: falloLectura } = await supabase
    .from('perfiles')
    .select('*')
    .eq('id', id)
    .maybeSingle<Perfil>();

  if (falloLectura) return errorDePostgres(falloLectura);
  if (!actual) return error('No encontramos el usuario que querés editar.', 404);

  const { errores, datos } = armarCambios(cuerpo, actual);
  if (Object.keys(errores).length > 0) {
    return error('Revisá los datos del usuario.', 422, { errores });
  }

  // --- resguardos de acceso -------------------------------------------------
  const esMiCuenta = actual.id === sesion.usuarioId;

  if (esMiCuenta && !datos.activo) {
    return error(
      'No podés desactivar tu propia cuenta. Si hace falta, que lo haga otro administrador.',
      403,
    );
  }

  if (esMiCuenta && actual.rol === 'admin' && datos.rol !== 'admin') {
    return error(
      'No podés quitarte a vos mismo el rol de administrador. Que lo haga otro administrador.',
      403,
    );
  }

  // Sin ningun admin activo no queda nadie que pueda volver a dar permisos, asi
  // que el ultimo no se puede degradar ni desactivar: primero se designa otro.
  const dejaDeAdministrar = actual.rol === 'admin' && actual.activo
    && (datos.rol !== 'admin' || !datos.activo);

  if (dejaDeAdministrar) {
    const { count, error: falloConteo } = await supabase
      .from('perfiles')
      .select('id', { count: 'exact', head: true })
      .eq('rol', 'admin')
      .eq('activo', true)
      .neq('id', actual.id);

    if (falloConteo) return errorDePostgres(falloConteo);

    if ((count ?? 0) === 0) {
      return error(
        `${actual.nombre} es el único administrador activo del sistema. Designá otro ` +
        'administrador antes de hacer este cambio.',
        409,
      );
    }
  }

  const { data: perfil, error: fallo } = await supabase
    .from('perfiles')
    .update({
      nombre: datos.nombre,
      cargo: datos.cargo,
      rol: datos.rol,
      dicta_clases: datos.dicta_clases,
      activo: datos.activo,
    })
    .eq('id', actual.id)
    .select('*')
    .maybeSingle<Perfil>();

  if (fallo) return errorDePostgres(fallo);
  // Sin filas afectadas es RLS: la politica perfiles_admin_edicion la bloqueo.
  if (!perfil) return error('No tenés permiso para modificar este usuario.', 403);

  const registros = await contarRegistros(supabase, perfil.id);
  // La sesion que le quede abierta deja de valer sola: sesionActual() y las
  // politicas RLS miran perfiles.activo en cada pedido, no el token.
  const seDesactivo = actual.activo && !perfil.activo;

  const usuario: UsuarioAdmin = { ...perfil, registros };

  return Response.json({
    usuario,
    registros_asociados: registros,
    aviso: seDesactivo ? avisoBaja(registros) : null,
  });
}
