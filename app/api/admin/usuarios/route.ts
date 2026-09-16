// /api/admin/usuarios - listado y alta de usuarios (REQ 2).
//
// El alta es, junto con el reseteo de contrasena, la unica operacion que usa la
// clave de servicio: crear una cuenta en auth.users es una operacion de la Admin
// API y no hay manera de hacerla con la sesion del usuario. El resto va con
// clienteServidor() para que RLS siga aplicando.
//
// El perfil de public.perfiles no se inserta desde aca: lo crea el trigger
// tg_nuevo_usuario leyendo el user_metadata del alta.

import { randomBytes } from 'node:crypto';
import { error, errorDePostgres } from '@/lib/consultas';
import { clienteAdministrador } from '@/lib/supabase/administrador';
import { clienteServidor, sesionActual, type Sesion } from '@/lib/supabase/servidor';
import type { Perfil, Rol } from '@/lib/tipos';

type ClienteServidor = Awaited<ReturnType<typeof clienteServidor>>;

/** Un perfil con el dato que el panel necesita antes de desactivarlo. */
interface UsuarioAdmin extends Perfil {
  registros: number;
}

const ROLES: readonly Rol[] = ['profesor', 'admin'];
const LARGOS = { nombre: 120, cargo: 80, email: 160 } as const;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Sin l, I, 1, O ni 0: la contrasena inicial se dicta por telefono o se anota en
// un papel, y esos caracteres se confunden entre si.
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS = '23456789';
const ALFABETO = MAYUSCULAS + MINUSCULAS + DIGITOS;
const LARGO_PASSWORD = 12;

const texto = (v: unknown) => String(v ?? '').trim();

/** Normaliza un booleano que puede llegar como texto desde un formulario. */
function bandera(valor: unknown, porDefecto: boolean): boolean {
  if (valor === undefined || valor === null || valor === '') return porDefecto;
  if (typeof valor === 'boolean') return valor;
  const s = String(valor).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'si' || s === 'sí') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return porDefecto;
}

/**
 * Indice al azar sin sesgo. El resto de 256 se descarta en lugar de tomar el
 * modulo directo, que favoreceria a los primeros caracteres del alfabeto.
 */
function indiceAleatorio(tope: number): number {
  const limite = 256 - (256 % tope);
  let byte = randomBytes(1)[0];
  while (byte >= limite) byte = randomBytes(1)[0];
  return byte % tope;
}

const caracter = (alfabeto: string) => alfabeto[indiceAleatorio(alfabeto.length)];

/**
 * Contrasena inicial: 12 caracteres sin ambiguedades, en tres grupos de cuatro
 * para poder leerla en voz alta. Se devuelve una sola vez y no se guarda.
 */
function generarPassword(): string {
  // Al menos una mayuscula, una minuscula y un digito, y despues se mezcla:
  // asi cumple cualquier politica de complejidad sin depender de la suerte.
  const letras = [caracter(MAYUSCULAS), caracter(MINUSCULAS), caracter(DIGITOS)];
  while (letras.length < LARGO_PASSWORD) letras.push(caracter(ALFABETO));
  for (let i = letras.length - 1; i > 0; i -= 1) {
    const j = indiceAleatorio(i + 1);
    [letras[i], letras[j]] = [letras[j], letras[i]];
  }
  const clave = letras.join('');
  return `${clave.slice(0, 4)}-${clave.slice(4, 8)}-${clave.slice(8)}`;
}

/**
 * Todo /api/admin es de rol admin. RLS ya lo limita, pero cortar antes deja un
 * mensaje entendible en lugar de un listado vacio o un error de permisos crudo.
 */
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

/**
 * Registros en los que el usuario figura como profesor responsable.
 * Se cuenta en la base con count exacto en vez de traer las filas: PostgREST
 * recorta la cantidad de filas que devuelve y un conteo recortado seria un
 * numero equivocado justo en la pantalla donde se decide una baja.
 */
async function contarRegistros(supabase: ClienteServidor, profesorId: string): Promise<number> {
  const { count } = await supabase
    .from('registros')
    .select('id', { count: 'exact', head: true })
    .eq('profesor_id', profesorId);
  return count ?? 0;
}

function validarAlta(cuerpo: Record<string, unknown>) {
  const errores: Record<string, string> = {};

  const nombre = texto(cuerpo.nombre);
  if (nombre.length < 2) {
    errores.nombre = 'Escribí el nombre y el apellido del usuario.';
  } else if (nombre.length > LARGOS.nombre) {
    errores.nombre = `El nombre no puede superar los ${LARGOS.nombre} caracteres.`;
  }

  const cargo = texto(cuerpo.cargo) || 'Profesor';
  if (cargo.length > LARGOS.cargo) {
    errores.cargo = `El cargo no puede superar los ${LARGOS.cargo} caracteres.`;
  }

  const email = texto(cuerpo.email).toLowerCase();
  if (!email) {
    errores.email = 'Indicá el correo electrónico con el que va a ingresar.';
  } else if (email.length > LARGOS.email) {
    errores.email = `El correo no puede superar los ${LARGOS.email} caracteres.`;
  } else if (!RE_EMAIL.test(email)) {
    errores.email = 'El correo electrónico no tiene un formato válido.';
  }

  const rol = (texto(cuerpo.rol).toLowerCase() || 'profesor') as Rol;
  if (!ROLES.includes(rol)) errores.rol = 'El rol tiene que ser «profesor» o «admin».';

  return {
    errores,
    datos: { nombre, cargo, email, rol, dicta_clases: bandera(cuerpo.dicta_clases, true) },
  };
}

// ---------------------------------------------------------------------------
// GET: todos, incluidos los inactivos. El panel necesita poder reactivarlos.
// ---------------------------------------------------------------------------
export async function GET() {
  const sesion = await sesionAdmin();
  if (sesion instanceof Response) return sesion;

  const supabase = await clienteServidor();

  const { data, error: fallo } = await supabase
    .from('perfiles')
    .select('*')
    .order('activo', { ascending: false })
    .order('nombre', { ascending: true })
    .returns<Perfil[]>();

  if (fallo) return errorDePostgres(fallo);

  const perfiles = data ?? [];
  // Un conteo por perfil: el listado de autorizados es de decenas de personas,
  // asi que las consultas salen en paralelo y el costo es despreciable.
  const usuarios: UsuarioAdmin[] = await Promise.all(
    perfiles.map(async (perfil) => ({
      ...perfil,
      registros: await contarRegistros(supabase, perfil.id),
    })),
  );

  return Response.json({ usuarios });
}

// ---------------------------------------------------------------------------
// POST: alta. Devuelve la contrasena generada una sola vez.
// ---------------------------------------------------------------------------
export async function POST(pedido: Request) {
  const sesion = await sesionAdmin();
  if (sesion instanceof Response) return sesion;

  const cuerpo = await leerCuerpo(pedido);
  if (!cuerpo) return error('El cuerpo del pedido no es un JSON válido.', 400);

  const { errores, datos } = validarAlta(cuerpo);
  if (Object.keys(errores).length > 0) {
    return error('Revisá los datos del usuario.', 422, { errores });
  }

  const supabase = await clienteServidor();

  // La Admin API tambien rechaza el correo repetido, pero con un mensaje en
  // ingles que no dice de quien es la cuenta ni que se puede reactivar.
  const { data: repetido } = await supabase
    .from('perfiles')
    .select('nombre, activo')
    .eq('email', datos.email)
    .maybeSingle<Pick<Perfil, 'nombre' | 'activo'>>();

  if (repetido) {
    const extra = repetido.activo
      ? ''
      : ' Esa cuenta está desactivada: podés volver a activarla en lugar de crear otra.';
    return error(
      `El correo «${datos.email}» ya está registrado en la cuenta de ${repetido.nombre}.${extra}`,
      409,
    );
  }

  let admin: ReturnType<typeof clienteAdministrador>;
  try {
    admin = clienteAdministrador();
  } catch {
    return error(
      'El servidor no tiene cargada la clave de servicio, que es necesaria para crear ' +
      'cuentas. Avisale a quien administra el sistema.',
      500,
    );
  }

  const password = generarPassword();

  const { data: alta, error: falloAlta } = await admin.auth.admin.createUser({
    email: datos.email,
    password,
    // No hay servidor de correo: la cuenta se entrega en mano, ya confirmada.
    email_confirm: true,
    user_metadata: {
      nombre: datos.nombre,
      cargo: datos.cargo,
      rol: datos.rol,
      dicta_clases: datos.dicta_clases,
      debe_cambiar_password: true,
    },
  });

  if (falloAlta || !alta?.user) {
    const mensaje = falloAlta?.message ?? '';
    if (/registered|already exists|email_exists/i.test(mensaje)) {
      return error(`Ya existe una cuenta con el correo «${datos.email}».`, 409);
    }
    // Nunca se registra la contrasena, solo el motivo del rechazo.
    console.error('[ciudad-activa] alta de usuario:', mensaje);
    return error('No se pudo crear la cuenta. Probá de nuevo en un momento.', 500);
  }

  // El perfil ya lo creo el trigger tg_nuevo_usuario con los datos del
  // user_metadata. Este update deja los valores exactos que se pidieron (el
  // trigger aplica valores por defecto si algo viene vacio) y de paso devuelve
  // la fila sin tener que volver a leerla.
  const { data: perfil, error: falloPerfil } = await supabase
    .from('perfiles')
    .update({
      nombre: datos.nombre,
      cargo: datos.cargo,
      rol: datos.rol,
      dicta_clases: datos.dicta_clases,
      activo: true,
    })
    .eq('id', alta.user.id)
    .select('*')
    .maybeSingle<Perfil>();

  if (falloPerfil) return errorDePostgres(falloPerfil);

  if (!perfil) {
    return error(
      `La cuenta de ${datos.nombre} se creó, pero no se generó su perfil en el sistema. ` +
      'Revisá que el trigger tg_nuevo_usuario esté instalado en la base y avisale a ' +
      'quien administra el servidor antes de volver a intentarlo.',
      500,
    );
  }

  const usuario: UsuarioAdmin = { ...perfil, registros: 0 };

  return Response.json(
    {
      usuario,
      // Se muestra una sola vez: no se guarda en ningun lado ni se puede volver
      // a consultar. Si se pierde, el camino es generar una nueva.
      password,
      password_aviso:
        'Anotá esta contraseña ahora: se muestra una sola vez, no queda guardada en ningún ' +
        'lado y no se puede volver a ver. Si se pierde, generá una nueva desde ' +
        '«Restablecer contraseña».',
      mensaje:
        `Usuario creado. ${perfil.nombre} ingresa con ${perfil.email} y tiene que cambiar ` +
        'la contraseña la primera vez.',
    },
    { status: 201 },
  );
}
