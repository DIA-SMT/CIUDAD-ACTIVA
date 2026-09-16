import { redirect } from 'next/navigation';
import { sesionActual } from '@/lib/supabase/servidor';

// La raiz no muestra nada: manda a cada uno a donde trabaja.
export const dynamic = 'force-dynamic';

export default async function Inicio() {
  const sesion = await sesionActual();

  if (!sesion) redirect('/ingresar');
  redirect(sesion.perfil.rol === 'admin' ? '/panel' : '/carga');
}
