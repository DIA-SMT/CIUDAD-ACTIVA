'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { traerJSON, useRecurso } from '@/lib/usar-recurso';
import type { Lugar } from '@/lib/tipos';

export function Espacios() {
  const [nombre, setNombre] = useState('');
  const [guardando, setGuardando] = useState(false);

  const { datos: listado, refrescar: traer } = useRecurso(
    '/api/admin/lugares',
    () => traerJSON<{ lugares: Lugar[] }>('/api/admin/lugares'),
  );
  const lugares = listado?.lugares ?? null;

  async function crear() {
    if (!nombre.trim()) return;
    setGuardando(true);
    const r = await fetch('/api/admin/lugares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: nombre.trim(), descripcion: '', orden: 0 }),
    });
    const d = await r.json().catch(() => null);
    setGuardando(false);

    if (!r.ok) {
      toast.error(d?.error ?? 'No se pudo crear el espacio.');
      return;
    }
    toast.success('Espacio agregado');
    setNombre('');
    traer();
  }

  async function alternar(l: Lugar) {
    const r = await fetch(`/api/admin/lugares/${l.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: !l.activo }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      toast.error(d?.error ?? 'No se pudo guardar el cambio.');
      return;
    }
    toast.success(
      l.activo ? 'Espacio desactivado' : 'Espacio activado',
      d?.aviso ? { description: d.aviso } : undefined,
    );
    traer();
  }

  if (!lugares) return <Skeleton className="h-64 w-full" />;

  return (
    <>
      <div className="mb-3 flex gap-2">
        <Input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del espacio nuevo"
          onKeyDown={(e) => e.key === 'Enter' && void crear()}
          aria-label="Nombre del espacio nuevo"
        />
        <Button onClick={() => void crear()} disabled={guardando || !nombre.trim()}>
          {guardando ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          Agregar
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Espacio</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lugares.map((l) => (
              <TableRow key={l.id} className={l.activo ? undefined : 'opacity-60'}>
                <TableCell className="font-medium">{l.nombre}</TableCell>
                <TableCell>
                  {l.activo ? (
                    <span className="text-verde-600 text-sm">Activo</span>
                  ) : (
                    <span className="text-muted-foreground text-sm">Inactivo</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => void alternar(l)}>
                    {l.activo ? 'Desactivar' : 'Activar'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground mt-2 text-xs text-balance">
        Los espacios no se eliminan: se desactivan. Dejan de ofrecerse en el formulario,
        pero las clases ya cargadas siguen contando en las estadísticas.
      </p>
    </>
  );
}
