// REQ 2 y REQ 3: el listado de profesores autorizados y los espacios definidos.
//
// Alimenta los desplegables del formulario de carga y es lo que recibe
// validarRegistro() para rechazar un profesor o un lugar que no correspondan.
// Solo trae lo activo: nadie carga contra un profesor dado de baja ni contra un
// espacio que el programa ya no usa.

import { error, errorDePostgres } from '@/lib/consultas';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';
import type { Catalogos, EstadoClase, Lugar, ProfesorOpcion } from '@/lib/tipos';

export async function GET() {
  // El middleware ya frena a quien no tenga sesion; esto ademas deja afuera al
  // usuario con token valido pero perfil desactivado, que sesionActual() filtra.
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);

  const supabase = await clienteServidor();

  const [profesores, lugares, estados] = await Promise.all([
    supabase
      .from('perfiles')
      .select('id, nombre, cargo, email')
      .eq('activo', true)
      .eq('dicta_clases', true)
      .order('nombre', { ascending: true })
      .returns<ProfesorOpcion[]>(),
    supabase
      .from('lugares')
      .select('id, nombre')
      .eq('activo', true)
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true })
      .returns<Pick<Lugar, 'id' | 'nombre'>[]>(),
    supabase
      .from('estados_clase')
      .select('codigo, nombre, es_suspension')
      .eq('activo', true)
      .order('orden', { ascending: true })
      .returns<Pick<EstadoClase, 'codigo' | 'nombre' | 'es_suspension'>[]>(),
  ]);

  const fallo = profesores.error ?? lugares.error ?? estados.error;
  if (fallo) return errorDePostgres(fallo);

  const catalogos: Catalogos = {
    profesores: profesores.data ?? [],
    lugares: lugares.data ?? [],
    estados: estados.data ?? [],
  };

  return Response.json(catalogos);
}
