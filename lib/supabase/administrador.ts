import { createClient } from '@supabase/supabase-js';

/**
 * Cliente con la clave de servicio. Saltea RLS, asi que solo se usa donde
 * hace falta de verdad: dar de alta usuarios en Supabase Auth y resetear
 * contrasenas, que son operaciones de la Admin API.
 *
 * Nunca se importa desde un componente de cliente: la clave vive solo en el
 * servidor y no lleva el prefijo NEXT_PUBLIC_ justamente para que Next falle
 * si alguien intenta usarla en el navegador.
 */
export function clienteAdministrador() {
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!clave) {
    throw new Error(
      'Falta SUPABASE_SERVICE_ROLE_KEY. Es necesaria para dar de alta usuarios ' +
      'y resetear contrasenas. Cargala en .env.local.',
    );
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, clave, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
