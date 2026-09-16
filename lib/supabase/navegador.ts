'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente de Supabase para el navegador.
 * Usa la clave anonima, que es publica por diseño: lo que protege los datos
 * son las politicas RLS de la migracion, no el secreto de esta clave.
 */
export function clienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
