'use client';

import { useState } from 'react';
import { Download, Eye, Loader2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { FormularioCarga } from '@/app/carga/formulario-carga';
import { fmt } from '@/lib/fechas';
import { traerJSON, useRecurso } from '@/lib/usar-recurso';
import type {
  Catalogos, EntradaHistorial, Pagina, Perfil, Registro,
} from '@/lib/tipos';
import { useFiltros } from './filtros';

const POR_PAGINA = 25;

export function Registros({
  perfil,
  catalogos,
}: {
  perfil: Perfil;
  catalogos: Catalogos;
}) {
  const { consulta } = useFiltros();
  const esAdmin = perfil.rol === 'admin';

  const [posicion, setPosicion] = useState({ clave: '', pagina: 1 });
  const pagina = posicion.clave === consulta ? posicion.pagina : 1;
  const setPagina = (n: number) => setPosicion({ clave: consulta, pagina: n });

  const [verDetalle, setVerDetalle] = useState<Registro | null>(null);
  const [historial, setHistorial] = useState<EntradaHistorial[] | null>(null);
  const [editando, setEditando] = useState<Registro | null>(null);
  const [borrando, setBorrando] = useState<Registro | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const ruta = `/api/registros?${consulta}&pagina=${pagina}&por_pagina=${POR_PAGINA}`;
  const { datos, error, refrescar: traer } = useRecurso(
    ruta,
    () => traerJSON<Pagina<Registro>>(ruta),
  );

  async function abrirDetalle(r: Registro) {
    setVerDetalle(r);
    setHistorial(null);
    try {
      const res = await fetch(`/api/registros/${r.id}/historial`);
      const d = await res.json();
      setHistorial(d.historial ?? []);
    } catch {
      setHistorial([]);
    }
  }

  async function eliminar() {
    if (!borrando) return;
    setTrabajando(true);
    const r = await fetch(`/api/registros/${borrando.id}`, { method: 'DELETE' });
    const d = await r.json().catch(() => null);
    setTrabajando(false);

    if (!r.ok) {
      toast.error(d?.error ?? 'No se pudo eliminar el registro.');
      return;
    }
    toast.success('Registro eliminado', {
      description: 'Queda asentado en el historial de modificaciones.',
    });
    setBorrando(null);
    setVerDetalle(null);
    void traer();
  }

  if (error) {
    return <p className="text-rojo-600 py-10 text-center text-sm">
      No se pudo cargar el listado.
    </p>;
  }

  if (!datos) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="no-imprimir flex flex-wrap items-center gap-3">
        <p className="text-muted-foreground text-sm">
          <span className="cifra font-medium">{fmt.numero(datos.total)}</span>{' '}
          {datos.total === 1 ? 'registro' : 'registros'}
        </p>
        <a
          href={`/api/registros/exportar?${consulta}`}
          className="ml-auto"
          download
        >
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4" aria-hidden />
            Exportar CSV
          </Button>
        </a>
      </div>

      {datos.datos.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-16 text-center text-balance">
            <p className="font-medium">No hay registros con estos filtros.</p>
            <p className="mt-1 text-sm">Probá ampliar el período o limpiar los filtros.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Profesor</TableHead>
                <TableHead>Lugar</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Alumnos</TableHead>
                <TableHead className="text-right">V / M</TableHead>
                <TableHead className="text-right">Nuevos</TableHead>
                <TableHead className="no-imprimir w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {datos.datos.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="cifra whitespace-nowrap">
                    {fmt.fecha(r.fecha)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{r.profesor_nombre}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.lugar_nombre}</TableCell>
                  <TableCell>
                    <Badge variant={r.es_suspension ? 'destructive' : 'secondary'}>
                      {r.estado_nombre}
                    </Badge>
                  </TableCell>
                  <TableCell className="cifra text-right">
                    {fmt.numero(r.alumnos_total)}
                  </TableCell>
                  <TableCell className="cifra text-muted-foreground text-right whitespace-nowrap">
                    {r.varones} / {r.mujeres}
                  </TableCell>
                  <TableCell className="cifra text-naranja-600 text-right">
                    {r.alumnos_nuevos > 0 ? fmt.numero(r.alumnos_nuevos) : '—'}
                  </TableCell>
                  <TableCell className="no-imprimir">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void abrirDetalle(r)}
                        aria-label={`Ver el detalle de la clase del ${fmt.fecha(r.fecha)}`}
                      >
                        <Eye className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditando(r)}
                        aria-label={`Editar la clase del ${fmt.fecha(r.fecha)}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      {esAdmin && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setBorrando(r)}
                          aria-label={`Eliminar la clase del ${fmt.fecha(r.fecha)}`}
                        >
                          <Trash2 className="text-rojo-600 h-4 w-4" aria-hidden />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {datos.paginas > 1 && (
        <div className="no-imprimir flex items-center justify-between gap-4">
          <Button
            variant="outline"
            size="sm"
            disabled={pagina <= 1}
            onClick={() => setPagina(pagina - 1)}
          >
            Anterior
          </Button>
          <p className="text-muted-foreground text-sm">
            Página <span className="cifra">{datos.pagina}</span> de{' '}
            <span className="cifra">{datos.paginas}</span>
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={pagina >= datos.paginas}
            onClick={() => setPagina(pagina + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}

      {/* --- detalle e historial (REQ 6) --- */}
      <Sheet open={verDetalle !== null} onOpenChange={(a) => !a && setVerDetalle(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {verDetalle && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {fmt.fecha(verDetalle.fecha)} · {verDetalle.lugar_nombre}
                </SheetTitle>
                <SheetDescription>
                  {verDetalle.profesor_cargo} {verDetalle.profesor_nombre}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-6 px-4 pb-6">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Estado', verDetalle.estado_nombre],
                    ['Total de alumnos', fmt.numero(verDetalle.alumnos_total)],
                    ['Varones', fmt.numero(verDetalle.varones)],
                    ['Mujeres', fmt.numero(verDetalle.mujeres)],
                    ['Alumnos nuevos', fmt.numero(verDetalle.alumnos_nuevos)],
                    ['Origen', verDetalle.origen === 'web' ? 'Cargado en el sistema' : 'Importado de la planilla'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-muted-foreground text-xs">{k}</dt>
                      <dd className="cifra font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>

                {verDetalle.observaciones && (
                  <div>
                    <p className="text-muted-foreground text-xs">Observaciones</p>
                    <p className="mt-1 text-sm">{verDetalle.observaciones}</p>
                  </div>
                )}

                <div className="text-muted-foreground space-y-0.5 text-xs">
                  <p>Responsable: {verDetalle.email_responsable}</p>
                  {verDetalle.cargado_por_nombre && (
                    <p>Cargado por: {verDetalle.cargado_por_nombre}</p>
                  )}
                  {/* En los importados, creado_en es cuando se reporto la clase
                      en la planilla vieja, no cuando entro a este sistema. */}
                  <p>
                    {verDetalle.origen === 'importacion' ? 'Reportado en la planilla' : 'Cargado'}
                    : {fmt.fechaHora(verDetalle.creado_en)}
                  </p>
                  {verDetalle.actualizado_en !== verDetalle.creado_en && (
                    <p>Última modificación: {fmt.fechaHora(verDetalle.actualizado_en)}</p>
                  )}
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-medium">Historial de modificaciones</h3>
                  {historial === null ? (
                    <Skeleton className="h-24 w-full" />
                  ) : historial.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Sin movimientos.</p>
                  ) : (
                    <ol className="border-border space-y-4 border-l pl-4">
                      {historial.map((h) => (
                        <li key={h.id} className="relative">
                          <span
                            className="bg-verde-600 absolute -left-[21px] top-1.5 size-2.5 rounded-full"
                            aria-hidden
                          />
                          <p className="text-sm">
                            {h.accion === 'creacion' && <strong>Creación</strong>}
                            {h.accion === 'eliminacion' && <strong>Eliminación</strong>}
                            {h.accion === 'modificacion' && (
                              <>
                                <strong>{h.etiqueta_campo || h.campo}</strong>{' '}
                                <span className="text-muted-foreground line-through">
                                  {h.valor_anterior || '—'}
                                </span>{' '}
                                → <span className="font-medium">{h.valor_nuevo || '—'}</span>
                              </>
                            )}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {h.usuario_nombre} · {fmt.fechaHora(h.fecha_hora)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* --- edicion, con el mismo control de suma del REQ 4 --- */}
      <Dialog open={editando !== null} onOpenChange={(a) => !a && setEditando(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Corregir la clase</DialogTitle>
            <DialogDescription>
              Cada cambio queda registrado en el historial, con tu nombre.
            </DialogDescription>
          </DialogHeader>
          {editando && (
            <FormularioCarga
              key={editando.id}
              perfil={perfil}
              catalogos={catalogos}
              editando={editando}
              onGuardado={() => void traer()}
              onCancelar={() => setEditando(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* --- baja --- */}
      <Dialog open={borrando !== null} onOpenChange={(a) => !a && setBorrando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar este registro?</DialogTitle>
            <DialogDescription>
              {borrando && (
                <>
                  {fmt.fecha(borrando.fecha)} · {borrando.lugar_nombre} ·{' '}
                  {borrando.profesor_nombre}, con {borrando.alumnos_total} alumnos.
                  <br />
                  El registro deja de contar en las estadísticas, pero la eliminación
                  queda asentada en el historial con tu nombre.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setBorrando(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void eliminar()} disabled={trabajando}>
              {trabajando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Sí, eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
