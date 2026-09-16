import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Perfil } from '@/lib/tipos';

/**
 * Cliente de Supabase para Server Components y Route Handlers.
 *
 * Va con la clave anonima y la sesion del usuario, a proposito: asi cada
 * consulta pasa por las politicas RLS y los permisos del REQ 6 los aplica la
 * base. Ademas auth.uid() queda disponible, que es lo que el trigger de
 * auditoria usa para saber quien hizo cada cambio.
 */
export async function clienteServidor() {
  const almacen = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => almacen.getAll(),
        setAll: (galletas) => {
          try {
            for (const { name, value, options } of galletas) {
              almacen.set(name, value, options);
            }
          } catch {
            // Desde un Server Component no se pueden escribir cookies. No es
            // un problema: el middleware ya refresco la sesion en este pedido.
          }
        },
      },
    },
  );
}

export interface Sesion {
  usuarioId: string;
  perfil: Perfil;
}

/**
 * Devuelve el perfil del usuario autenticado, o null.
 * Se apoya en getUser(), que valida el token contra Supabase; getSession() lee
 * la cookie sin verificarla y no sirve para decidir permisos.
 */
export async function sesionActual(): Promise<Sesion | null> {
  const supabase = await clienteServidor();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('*')
    .eq('id', user.id)
    .single<Perfil>();

  // Un usuario dado de baja conserva el token hasta que vence, pero no entra.
  if (!perfil || !perfil.activo) return null;

  return { usuarioId: user.id, perfil };
}
