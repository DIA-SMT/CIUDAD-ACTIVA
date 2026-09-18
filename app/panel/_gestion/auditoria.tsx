'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { fmt } from '@/lib/fechas';
import { traerJSON, useRecurso } from '@/lib/usar-recurso';
import type { EntradaHistorial, Pagina } from '@/lib/tipos';

const ACCIONES: Record<string, string> = {
  creacion: 'Creación',
  modificacion: 'Modificación',
  eliminacion: 'Eliminación',
};

export function Auditoria() {
  const [pagina, setPagina] = useState(1);

  const ruta = `/api/admin/historial?pagina=${pagina}&por_pagina=30`;
  const { datos, error } = useRecurso(ruta, () => traerJSON<Pagina<EntradaHistorial>>(ruta));

  if (error) {
    return (
      <p className="text-rojo-600 py-8 text-center text-sm">
        No se pudo cargar la auditoría.
      </p>
    );
  }
  if (!datos) return <Skeleton className="h-64 w-full" />;

  return (
    <>
      <p className="text-muted-foreground mb-3 text-sm text-balance">
        Todo lo que se creó, modificó, aprobó o eliminó, con quién lo hizo y cuándo. Lo
        escribe la base de datos con cada cambio, no la aplicación: no hay forma de tocar
        un registro sin que quede acá.
      </p>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cuándo</TableHead>
              <TableHead>Quién</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Cambio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {datos.datos.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="cifra whitespace-nowrap">
                  {fmt.fechaHora(h.fecha_hora)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{h.usuario_nombre || '—'}</TableCell>
                <TableCell>
                  <Badge variant={h.accion === 'eliminacion' ? 'destructive' : 'secondary'}>
                    {ACCIONES[h.accion] ?? h.accion}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {h.accion === 'modificacion' ? (
                    <>
                      <strong>{h.etiqueta_campo || h.campo}</strong>{' '}
                      <span className="text-muted-foreground line-through">
                        {h.valor_anterior || '—'}
                      </span>{' '}
                      → {h.valor_nuevo || '—'}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {h.valor_nuevo || h.valor_anterior || '—'}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {datos.paginas > 1 && (
        <div className="mt-3 flex items-center justify-between gap-4">
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
    </>
  );
}
