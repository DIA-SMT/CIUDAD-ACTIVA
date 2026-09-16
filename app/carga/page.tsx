import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { BarraSuperior } from '@/components/barra-superior';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';
import type { Catalogos, EstadoClase, Lugar, ProfesorOpcion } from '@/lib/tipos';
import { PantallaCarga } from './pantalla-carga';

export const metadata: Metadata = { title: 'Cargar clase' };
export const dynamic = 'force-dynamic';

/**
 * Los catalogos se leen en el servidor y viajan con el HTML: el profesor abre
 * la pantalla y ya tiene los desplegables, sin una llamada mas desde la plaza
 * con la señal que haya.
 */
async function traerCatalogos(): Promise<Catalogos> {
  const supabase = await clienteServidor();

  const [profesores, lugares, estados] = await Promise.all([
    supabase
      .from('perfiles')
      .select('id, nombre, cargo, email')
      .eq('activo', true)
      .eq('dicta_clases', true)
      .order('nombre')
      .returns<ProfesorOpcion[]>(),
    supabase
      .from('lugares')
      .select('id, nombre')
      .eq('activo', true)
      .order('orden')
      .returns<Pick<Lugar, 'id' | 'nombre'>[]>(),
    supabase
      .from('estados_clase')
      .select('codigo, nombre, es_suspension')
      .eq('activo', true)
      .order('orden')
      .returns<Pick<EstadoClase, 'codigo' | 'nombre' | 'es_suspension'>[]>(),
  ]);

  return {
    profesores: profesores.data ?? [],
    lugares: lugares.data ?? [],
    estados: estados.data ?? [],
  };
}

export default async function Carga() {
  const sesion = await sesionActual();
  if (!sesion) redirect('/ingresar?volver=/carga');

  const catalogos = await traerCatalogos();

  return (
    <>
      <BarraSuperior perfil={sesion.perfil} actual="carga" />
      <main className="flex-1">
        <PantallaCarga perfil={sesion.perfil} catalogos={catalogos} />
      </main>
    </>
  );
}
