// /api/admin/usuarios/[id]/password - reseteo de contrasena.
//
// Es la otra operacion que necesita la clave de servicio: cambiar la contrasena
// de otra persona se hace con la Admin API de Supabase Auth. La contrasena nueva
// se genera en el servidor, se devuelve una sola vez y no se guarda ni se
// registra en ningun log.
//
// El generador esta repetido en el alta de usuarios a proposito: un route.ts no
// puede exportar nada que no sea un metodo HTTP, asi que no hay forma de
// compartirlo entre los dos handlers sin sacarlo del router.

import { randomBytes } from 'node:crypto';
import { error, errorDePostgres } from '@/lib/consultas';
import { clienteAdministrador } from '@/lib/supabase/administrador';
import { clienteServidor, sesionActual, type Sesion } from '@/lib/supabase/servidor';
import type { Perfil } from '@/lib/tipos';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sin l, I, 1, O ni 0: la contrasena se dicta por telefono o se anota en un
// papel, y esos caracteres se confunden entre si.
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS = '23456789';
const ALFABETO = MAYUSCULAS + MINUSCULAS + DIGITOS;
const LARGO_PASSWORD = 12;

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

/** 12 caracteres sin ambiguedades, en tres grupos de cuatro para leerla en voz alta. */
function generarPassword(): string {
  const letras = [caracter(MAYUSCULAS), caracter(MINUSCULAS), caracter(DIGITOS)];
  while (letras.length < LARGO_PASSWORD) letras.push(caracter(ALFABETO));
  for (let i = letras.length - 1; i > 0; i -= 1) {
    const j = indiceAleatorio(i + 1);
    [letras[i], letras[j]] = [letras[j], letras[i]];
  }
  const clave = letras.join('');
  return `${clave.slice(0, 4)}-${clave.slice(4, 8)}-${clave.slice(8)}`;
}

async function sesionAdmin(): Promise<Sesion | Response> {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);
  if (sesion.perfil.rol !== 'admin') {
    return error(
      'Restablecer contraseñas es sólo para la administración del programa. ' +
      'Si no podés ingresar, pedíselo a la Dirección.',
      403,
    );
  }
  return sesion;
}

export async function POST(_pedido: Request, contexto: { params: Promise<{ id: string }> }) {
  const sesion = await sesionAdmin();
  if (sesion instanceof Response) return sesion;

  const { id } = await contexto.params;
  if (!UUID.test(id)) return error('El identificador del usuario no es válido.', 400);

  const supabase = await clienteServidor();

  const { data: perfil, error: falloLectura } = await supabase
    .from('perfiles')
    .select('*')
    .eq('id', id)
    .maybeSingle<Perfil>();

  if (falloLectura) return errorDePostgres(falloLectura);
  if (!perfil) return error('No encontramos el usuario.', 404);

  let admin: ReturnType<typeof clienteAdministrador>;
  try {
    admin = clienteAdministrador();
  } catch {
    return error(
      'El servidor no tiene cargada la clave de servicio, que es necesaria para restablecer ' +
      'contraseñas. Avisale a quien administra el sistema.',
      500,
    );
  }

  const password = generarPassword();

  const { error: falloAdmin } = await admin.auth.admin.updateUserById(id, {
    password,
    // user_metadata se mezcla con lo que ya habia: nombre, cargo y rol quedan
    // como estaban y solo se vuelve a levantar el aviso de cambio obligatorio.
    user_metadata: { debe_cambiar_password: true },
  });

  if (falloAdmin) {
    // Nunca se registra la contrasena, solo el motivo del rechazo.
    console.error('[ciudad-activa] reseteo de contrasena:', falloAdmin.message);
    if (falloAdmin.status === 404) {
      return error('La cuenta no existe en el sistema de ingreso.', 404);
    }
    return error('No se pudo restablecer la contraseña. Probá de nuevo en un momento.', 500);
  }

  const { count } = await supabase
    .from('registros')
    .select('id', { count: 'exact', head: true })
    .eq('profesor_id', perfil.id);

  const avisos = [
    `Contraseña restablecida. ${perfil.nombre} ingresa con ${perfil.email} y tiene que ` +
    'cambiarla la primera vez.',
  ];
  if (!perfil.activo) {
    avisos.push('Ojo: la cuenta está desactivada, así que todavía no va a poder ingresar.');
  }
  if (perfil.id === sesion.usuarioId) {
    avisos.push('Restableciste tu propia contraseña: puede que tengas que volver a ingresar.');
  }

  return Response.json({
    usuario: { ...perfil, registros: count ?? 0 },
    // Se muestra una sola vez: no se guarda en ningun lado ni se puede volver a
    // consultar. Si se pierde, el camino es generar otra.
    password,
    password_aviso:
      'Anotá esta contraseña ahora: se muestra una sola vez, no queda guardada en ningún ' +
      'lado y no se puede volver a ver. Si se pierde, generá una nueva.',
    mensaje: avisos.join(' '),
  });
}
