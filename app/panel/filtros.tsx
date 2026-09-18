'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { hoyISO, inicioDeAnio, mesesAtras } from '@/lib/fechas';
import type { Catalogos, Filtros } from '@/lib/tipos';

/** Todos los valores del filtro viajan por la URL, asi una vista se comparte. */
export function useFiltros() {
  const router = useRouter();
  const ruta = usePathname();
  const sp = useSearchParams();

  const filtros = useMemo<Filtros>(() => {
    const f: Filtros = {};
    const desde = sp.get('desde');
    const hasta = sp.get('hasta');
    const profesor = sp.get('profesor_id');
    const lugar = sp.get('lugar_id');
    const estado = sp.get('estado');
    const q = sp.get('q');
    const aprobacion = sp.get('aprobacion');
    if (aprobacion === 'pendiente' || aprobacion === 'aprobado' || aprobacion === 'rechazado') {
      f.aprobacion = aprobacion;
    }
    if (desde) f.desde = desde;
    if (hasta) f.hasta = hasta;
    if (profesor) f.profesor_id = profesor;
    if (lugar) f.lugar_id = Number(lugar);
    if (estado) f.estado = estado;
    if (q) f.q = q;
    return f;
  }, [sp]);

  const aplicar = useCallback(
    (cambios: Partial<Record<keyof Filtros, string | number | undefined>>) => {
      const p = new URLSearchParams(sp.toString());
      for (const [clave, valor] of Object.entries(cambios)) {
        if (valor === undefined || valor === '' || valor === 'todos') p.delete(clave);
        else p.set(clave, String(valor));
      }
      router.replace(`${ruta}?${p.toString()}`, { scroll: false });
    },
    [router, ruta, sp],
  );

  const limpiar = useCallback(() => {
    const p = new URLSearchParams(sp.toString());
    for (const c of ['desde', 'hasta', 'profesor_id', 'lugar_id', 'estado', 'q', 'aprobacion']) {
      p.delete(c);
    }
    router.replace(`${ruta}?${p.toString()}`, { scroll: false });
  }, [router, ruta, sp]);

  /** Query string para pasarle a la API. */
  const consulta = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) {
      if (v !== undefined && v !== '') p.set(k, String(v));
    }
    return p.toString();
  }, [filtros]);

  const hayFiltros = Object.keys(filtros).length > 0;

  return { filtros, consulta, hayFiltros, aplicar, limpiar };
}

const ATAJOS = [
  { nombre: 'Este mes', desde: () => mesesAtras(0), hasta: () => hoyISO() },
  { nombre: 'Últimos 3 meses', desde: () => mesesAtras(2), hasta: () => hoyISO() },
  { nombre: 'Este año', desde: () => inicioDeAnio(), hasta: () => hoyISO() },
];

export function BarraFiltros({ catalogos }: { catalogos: Catalogos }) {
  const { filtros, hayFiltros, aplicar, limpiar } = useFiltros();

  return (
    <div className="bg-card no-imprimir rounded-xl border p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <div className="space-y-1.5">
          <Label htmlFor="f-desde" className="text-xs">Desde</Label>
          <Input
            id="f-desde"
            type="date"
            max={hoyISO()}
            value={filtros.desde ?? ''}
            onChange={(e) => aplicar({ desde: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="f-hasta" className="text-xs">Hasta</Label>
          <Input
            id="f-hasta"
            type="date"
            max={hoyISO()}
            value={filtros.hasta ?? ''}
            onChange={(e) => aplicar({ hasta: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="f-profesor" className="text-xs">Profesor</Label>
          <Select
            value={filtros.profesor_id ?? 'todos'}
            onValueChange={(v) => aplicar({ profesor_id: v ?? 'todos' })}
          >
            <SelectTrigger id="f-profesor" className="w-full">
              <SelectValue>
                {(v: string | null) =>
                  catalogos.profesores.find((p) => p.id === v)?.nombre ?? 'Todos'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {catalogos.profesores.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="f-lugar" className="text-xs">Lugar</Label>
          <Select
            value={filtros.lugar_id ? String(filtros.lugar_id) : 'todos'}
            onValueChange={(v) => aplicar({ lugar_id: v ?? 'todos' })}
          >
            <SelectTrigger id="f-lugar" className="w-full">
              <SelectValue>
                {(v: string | null) =>
                  catalogos.lugares.find((l) => String(l.id) === v)?.nombre ?? 'Todos'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {catalogos.lugares.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>{l.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="f-estado" className="text-xs">Estado</Label>
          <Select
            value={filtros.estado ?? 'todos'}
            onValueChange={(v) => aplicar({ estado: v ?? 'todos' })}
          >
            <SelectTrigger id="f-estado" className="w-full">
              <SelectValue>
                {(v: string | null) =>
                  catalogos.estados.find((e) => e.codigo === v)?.nombre ?? 'Todos'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {catalogos.estados.map((e) => (
                <SelectItem key={e.codigo} value={e.codigo}>{e.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="f-aprobacion" className="text-xs">Revisión</Label>
          <Select
            value={filtros.aprobacion ?? 'todos'}
            onValueChange={(v) => aplicar({ aprobacion: v ?? 'todos' })}
          >
            <SelectTrigger id="f-aprobacion" className="w-full">
              <SelectValue>
                {(v: string | null) =>
                  ({ pendiente: 'Pendientes', aprobado: 'Aprobadas', rechazado: 'Rechazadas' })[
                    String(v)
                  ] ?? 'Todas'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas</SelectItem>
              <SelectItem value="pendiente">Pendientes</SelectItem>
              <SelectItem value="aprobado">Aprobadas</SelectItem>
              <SelectItem value="rechazado">Rechazadas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="f-q" className="text-xs">Buscar</Label>
          <Input
            id="f-q"
            type="search"
            placeholder="En observaciones…"
            defaultValue={filtros.q ?? ''}
            onBlur={(e) => aplicar({ q: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') aplicar({ q: (e.target as HTMLInputElement).value });
            }}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ATAJOS.map((a) => (
          <Button
            key={a.nombre}
            variant="outline"
            size="sm"
            onClick={() => aplicar({ desde: a.desde(), hasta: a.hasta() })}
          >
            {a.nombre}
          </Button>
        ))}
        <Button variant="outline" size="sm" onClick={() => aplicar({ desde: '', hasta: '' })}>
          Todo el período
        </Button>

        {hayFiltros && (
          <Button variant="ghost" size="sm" onClick={limpiar} className="ml-auto">
            <X className="h-4 w-4" aria-hidden />
            Limpiar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
