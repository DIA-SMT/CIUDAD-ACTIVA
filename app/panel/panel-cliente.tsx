'use client';

import { Suspense } from 'react';
import { Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Catalogos, Perfil } from '@/lib/tipos';
import { BarraFiltros } from './filtros';
import { Gestion } from './gestion';
import { Registros } from './registros';
import { Tablero } from './tablero';

function PanelInterno({
  perfil,
  catalogos,
}: {
  perfil: Perfil;
  catalogos: Catalogos;
}) {
  const esAdmin = perfil.rol === 'admin';

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6">
      {!esAdmin && (
        <Alert className="no-imprimir">
          <Info className="h-4 w-4" aria-hidden />
          <AlertDescription>
            Estás en modo consulta: podés ver y filtrar toda la información del programa,
            pero las correcciones de otros profesores y la gestión las hace la Dirección.
          </AlertDescription>
        </Alert>
      )}

      <BarraFiltros catalogos={catalogos} />

      <Tabs defaultValue="tablero">
        <TabsList className="no-imprimir">
          <TabsTrigger value="tablero">Tablero</TabsTrigger>
          <TabsTrigger value="registros">Registros</TabsTrigger>
          {esAdmin && <TabsTrigger value="gestion">Gestión</TabsTrigger>}
        </TabsList>

        <TabsContent value="tablero" className="mt-5">
          <Tablero />
        </TabsContent>

        <TabsContent value="registros" className="mt-5">
          <Registros perfil={perfil} catalogos={catalogos} />
        </TabsContent>

        {esAdmin && (
          <TabsContent value="gestion" className="mt-5">
            <Gestion perfil={perfil} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export function PanelCliente(props: { perfil: Perfil; catalogos: Catalogos }) {
  // useSearchParams (los filtros del REQ 8 viven en la URL) exige Suspense.
  return (
    <Suspense fallback={<Skeleton className="m-4 h-96" />}>
      <PanelInterno {...props} />
    </Suspense>
  );
}
