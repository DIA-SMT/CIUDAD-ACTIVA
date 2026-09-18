// Cuántas cargas esperan revisión.
//
// El tablero lo muestra como aviso: como los indicadores sólo cuentan lo
// aprobado, si nadie revisa durante una semana el tablero mostraría esa semana
// vacía sin explicación. Este número es lo que evita esa confusión.

import { error } from '@/lib/consultas';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);

  const supabase = await clienteServidor();

  const { count, error: fallo } = await supabase
    .from('registros')
    .select('id', { count: 'exact', head: true })
    .eq('aprobacion', 'pendiente');

  if (fallo) {
    // El aviso es accesorio: si falla, el tablero sigue funcionando sin él.
    return Response.json({ pendientes: 0 });
  }

  return Response.json({ pendientes: count ?? 0 });
}
