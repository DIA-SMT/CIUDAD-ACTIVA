'use client';

import { Suspense, useCallback, useState } from 'react';
import { ClipboardCheck, Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { traerJSON, useRecurso } from '@/lib/usar-recurso';
import type { Catalogos, EstadoRevision, Perfil } from '@/lib/tipos';
import { Asistente } from './asistente';
import { BarraFiltros } from './filtros';
import { Gestion } from './gestion';
import { Registros } from './registros';
import { Revision } from './revision';
import { Tablero } from './tablero';

type Pestania = 'tablero' | 'registros' | 'revision' | 'asistente' | 'gestion';

function PanelInterno({
  perfil,
  catalogos,
}: {
  perfil: Perfil;
  catalogos: Catalogos;
}) {
  const esAdmin = perfil.rol === 'admin';
  const [pestania, setPestania] = useState<Pestania>('tablero');
  const [version, setVersion] = useState(0);

  // Cuántas cargas esperan revisión. Como los indicadores sólo cuentan lo
  // aprobado, sin este aviso un período sin revisar se vería vacío en el
  // tablero y nadie entendería por qué.
  const { datos: revision, refrescar } = useRecurso(
    `/api/registros/pendientes#${version}`,
    () => traerJSON<EstadoRevision>('/api/registros/pendientes'),
  );
  const pendientes = revision?.pendientes ?? 0;

  const alRevisar = useCallback(() => {
    setVersion((n) => n + 1);
    refrescar();
  }, [refrescar]);

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

      {esAdmin && pendientes > 0 && (
        <Alert className="no-imprimir border-amarillo-600/40 bg-amarillo-500/10">
          <ClipboardCheck className="text-amarillo-600 h-4 w-4" aria-hidden />
          <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Hay <strong className="cifra">{pendientes}</strong>{' '}
              {pendientes === 1
                ? 'clase esperando revisión. Todavía no cuenta en los indicadores.'
                : 'clases esperando revisión. Todavía no cuentan en los indicadores.'}
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => setPestania('revision')}
            >
              {pendientes === 1 ? 'Revisarla ahora' : 'Revisarlas ahora'}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <BarraFiltros catalogos={catalogos} />

      <Tabs value={pestania} onValueChange={(v) => setPestania((v as Pestania) ?? 'tablero')}>
        <TabsList className="no-imprimir">
          <TabsTrigger value="tablero">Tablero</TabsTrigger>
          <TabsTrigger value="registros">Registros</TabsTrigger>
          {esAdmin && (
            <TabsTrigger value="revision">
              Revisión
              {pendientes > 0 && (
                <Badge
                  variant="outline"
                  className="border-amarillo-600/40 bg-amarillo-500/20 text-amarillo-600 ml-1.5 px-1.5"
                >
                  {pendientes}
                </Badge>
              )}
            </TabsTrigger>
          )}
          {esAdmin && <TabsTrigger value="asistente">Asistente</TabsTrigger>}
          {esAdmin && <TabsTrigger value="gestion">Gestión</TabsTrigger>}
        </TabsList>

        <TabsContent value="tablero" className="mt-5">
          {/* version cambia al revisar: el tablero vuelve a pedir los indicadores. */}
          <Tablero version={version} />
        </TabsContent>

        <TabsContent value="registros" className="mt-5">
          <Registros perfil={perfil} catalogos={catalogos} version={version} />
        </TabsContent>

        {esAdmin && (
          <TabsContent value="revision" className="mt-5">
            <Revision onCambio={alRevisar} />
          </TabsContent>
        )}

        {esAdmin && (
          <TabsContent value="asistente" className="mt-5">
            <Asistente perfil={perfil} />
          </TabsContent>
        )}

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
