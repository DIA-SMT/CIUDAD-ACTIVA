'use client';

import { useState } from 'react';
import { Check, Loader2, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { InsigniaAprobacion } from '@/components/insignia-aprobacion';
import { fmt } from '@/lib/fechas';
import { traerJSON, useRecurso } from '@/lib/usar-recurso';
import type { Aprobacion, Pagina, RegistroRevision } from '@/lib/tipos';
import { useFiltros } from './filtros';

function Ficha({
  r,
  children,
}: {
  r: RegistroRevision;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">
              {fmt.fecha(r.fecha)} · {r.lugar_nombre}
            </p>
            <InsigniaAprobacion estado={r.aprobacion} />
            {r.es_suspension && (
              <span className="text-rojo-600 text-xs">{r.estado_nombre}</span>
            )}
          </div>

          <p className="text-muted-foreground text-sm">
            {r.profesor_cargo} {r.profesor_nombre}
            {r.cargado_por_nombre && r.cargado_por !== r.profesor_id && (
              <> · cargada por {r.cargado_por_nombre}</>
            )}
          </p>

          {!r.es_suspension && (
            <p className="cifra text-sm">
              <strong>{fmt.numero(r.alumnos_total)}</strong> alumnos ·{' '}
              {fmt.numero(r.varones)} varones, {fmt.numero(r.mujeres)} mujeres
              {r.alumnos_nuevos > 0 && (
                <span className="text-naranja-600">
                  {' '}· {fmt.numero(r.alumnos_nuevos)} nuevos
                </span>
              )}
            </p>
          )}

          {r.observaciones && (
            <p className="text-muted-foreground border-l-2 pl-3 text-sm italic">
              {r.observaciones}
            </p>
          )}

          {r.aprobacion === 'rechazado' && r.motivo_rechazo && (
            <p className="text-rojo-600 bg-rojo-600/5 rounded px-2 py-1.5 text-sm">
              <strong>Motivo del rechazo:</strong> {r.motivo_rechazo}
            </p>
          )}

          <p className="text-muted-foreground text-xs">
            Cargada el {fmt.fechaHora(r.creado_en)}
            {r.revisado_en && r.revisado_por_nombre && (
              <> · revisada por {r.revisado_por_nombre} el {fmt.fechaHora(r.revisado_en)}</>
            )}
          </p>
        </div>

        {children && <div className="flex shrink-0 gap-2">{children}</div>}
      </CardContent>
    </Card>
  );
}

function Cola({
  estado,
  vacio,
  onCambio,
}: {
  estado: Aprobacion;
  vacio: { titulo: string; detalle: string };
  onCambio: () => void;
}) {
  const { consulta } = useFiltros();
  const [rechazando, setRechazando] = useState<RegistroRevision | null>(null);
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState<number | null>(null);

  // La barra de filtros ya puede traer su propio 'aprobacion'. Si se dejara,
  // habria dos en la query y ganaria el de la barra: la cola mostraria otra
  // cosa que la que dice su pestaña.
  const base = new URLSearchParams(consulta);
  base.delete('aprobacion');
  base.set('aprobacion', estado);
  base.set('por_pagina', '50');
  base.set('orden', 'fecha_desc');
  const ruta = `/api/registros?${base.toString()}`;
  const { datos, error, refrescar } = useRecurso(
    ruta,
    () => traerJSON<Pagina<RegistroRevision>>(ruta),
  );

  async function decidir(r: RegistroRevision, decision: Aprobacion, texto = '') {
    setTrabajando(r.id);
    const res = await fetch(`/api/registros/${r.id}/aprobacion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, motivo: texto }),
    });
    const d = await res.json().catch(() => null);
    setTrabajando(null);

    if (!res.ok) {
      toast.error(d?.error ?? 'No se pudo guardar la decisión.');
      return;
    }

    const nombre = `${fmt.fecha(r.fecha)} · ${r.lugar_nombre}`;
    if (decision === 'aprobado') {
      toast.success('Clase aprobada', { description: `${nombre}. Ya cuenta en el tablero.` });
    } else if (decision === 'rechazado') {
      toast.success('Clase rechazada', { description: `${nombre}. No cuenta en el tablero.` });
    } else {
      toast.success('Volvió a pendiente', { description: nombre });
    }

    setRechazando(null);
    setMotivo('');
    refrescar();
    onCambio();
  }

  if (error) {
    return <p className="text-rojo-600 py-8 text-center text-sm">No se pudo cargar la cola.</p>;
  }

  if (!datos) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    );
  }

  if (datos.datos.length === 0) {
    return (
      <div className="text-muted-foreground py-14 text-center text-balance">
        <p className="font-medium">{vacio.titulo}</p>
        <p className="mt-1 text-sm">{vacio.detalle}</p>
      </div>
    );
  }

  return (
    <>
      <p className="text-muted-foreground mb-3 text-sm">
        <span className="cifra font-medium">{fmt.numero(datos.total)}</span>{' '}
        {datos.total === 1 ? 'clase' : 'clases'}
        {datos.total > datos.datos.length && (
          <> · se muestran las {datos.datos.length} más recientes</>
        )}
      </p>

      <div className="space-y-3">
        {datos.datos.map((r) => (
          <Ficha key={r.id} r={r}>
            {estado === 'pendiente' ? (
              <>
                <Button
                  size="sm"
                  onClick={() => void decidir(r, 'aprobado')}
                  disabled={trabajando === r.id}
                >
                  {trabajando === r.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Check className="h-4 w-4" aria-hidden />
                  )}
                  Aprobar
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { setRechazando(r); setMotivo(''); }}
                  disabled={trabajando === r.id}
                >
                  <X className="h-4 w-4" aria-hidden />
                  Rechazar
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void decidir(r, 'pendiente')}
                disabled={trabajando === r.id}
                title="Vuelve a la cola de revisión"
              >
                {trabajando === r.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Undo2 className="h-4 w-4" aria-hidden />
                )}
                Revisar de nuevo
              </Button>
            )}
          </Ficha>
        ))}
      </div>

      {/* El motivo es obligatorio: el profesor tiene que saber qué pasó. */}
      <Dialog open={rechazando !== null} onOpenChange={(a) => !a && setRechazando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar esta carga</DialogTitle>
            <DialogDescription>
              {rechazando && (
                <>
                  {fmt.fecha(rechazando.fecha)} · {rechazando.lugar_nombre} ·{' '}
                  {rechazando.profesor_nombre}.
                  <br />
                  La clase no va a contar en el tablero. El profesor va a ver el motivo en
                  sus cargas, y si hay que corregirla tendrá que registrarla de nuevo.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo del rechazo</Label>
            <Textarea
              id="motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por ejemplo: los números no coinciden con la planilla del día"
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setRechazando(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || trabajando !== null}
              onClick={() => rechazando && void decidir(rechazando, 'rechazado', motivo.trim())}
            >
              {trabajando !== null && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Rechazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Revision({ onCambio }: { onCambio: () => void }) {
  return (
    <Tabs defaultValue="pendiente">
      <TabsList className="mb-4">
        <TabsTrigger value="pendiente">Esperando revisión</TabsTrigger>
        <TabsTrigger value="rechazado">Rechazadas</TabsTrigger>
      </TabsList>

      <TabsContent value="pendiente">
        <Cola
          estado="pendiente"
          vacio={{
            titulo: 'No hay nada esperando revisión.',
            detalle: 'Cuando un profesor cargue una clase, va a aparecer acá.',
          }}
          onCambio={onCambio}
        />
      </TabsContent>

      <TabsContent value="rechazado">
        <Cola
          estado="rechazado"
          vacio={{
            titulo: 'No hay cargas rechazadas.',
            detalle: 'Las que rechaces van a quedar acá, con su motivo.',
          }}
          onCambio={onCambio}
        />
      </TabsContent>
    </Tabs>
  );
}
