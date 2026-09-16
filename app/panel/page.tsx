import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { BarraSuperior } from '@/components/barra-superior';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';
import type { Catalogos, EstadoClase, Lugar, ProfesorOpcion } from '@/lib/tipos';
import { PanelCliente } from './panel-cliente';

export const metadata: Metadata = { title: 'Panel' };
export const dynamic = 'force-dynamic';

export default async function Panel() {
  const sesion = await sesionActual();
  if (!sesion) redirect('/ingresar?volver=/panel');

  // Los catalogos alimentan los desplegables de los filtros del REQ 8.
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

  const catalogos: Catalogos = {
    profesores: profesores.data ?? [],
    lugares: lugares.data ?? [],
    estados: estados.data ?? [],
  };

  return (
    <>
      <BarraSuperior perfil={sesion.perfil} actual="panel" />
      <main className="flex-1">
        <PanelCliente perfil={sesion.perfil} catalogos={catalogos} />
      </main>
    </>
  );
}
