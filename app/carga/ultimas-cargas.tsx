'use client';

import { useEffect } from 'react';
import { Pencil } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { diasEntre, fmt, hoyISO } from '@/lib/fechas';
import { traerJSON, useRecurso } from '@/lib/usar-recurso';
import type { Pagina, Perfil, Registro } from '@/lib/tipos';

/** Debe coincidir con parametros.ventana_edicion_dias de la base. */
const VENTANA_DIAS = 7;

export function UltimasCargas({
  perfil,
  recargar,
  onEditar,
}: {
  perfil: Perfil;
  /** Cambia de valor cuando se guarda algo, para volver a pedir la lista. */
  recargar: number;
  onEditar: (r: Registro) => void;
}) {
  const ruta = `/api/registros?profesor_id=${perfil.id}&por_pagina=10&orden=creado_desc`;
  // `recargar` entra en la clave para volver a pedir despues de cada guardado.
  const { datos, error, refrescar } = useRecurso(
    `${ruta}#${recargar}`,
    () => traerJSON<Pagina<Registro>>(ruta),
  );
  const registros = datos?.datos ?? null;

  useEffect(() => { refrescar(); }, [recargar, refrescar]);

  const editable = (r: Registro) =>
    perfil.rol === 'admin' || diasEntre(r.fecha, hoyISO()) <= VENTANA_DIAS;

  if (registros === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error) return <p className="text-rojo-600 text-sm">{error}</p>;

  if (registros.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm text-balance">
        Todavía no cargaste ninguna clase. La primera que registres va a aparecer acá.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {registros.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {fmt.fecha(r.fecha)} · {r.lugar_nombre}
            </p>
            <p className="text-muted-foreground text-xs">
              {r.es_suspension ? (
                <Badge variant="destructive" className="mr-1">
                  {r.estado_nombre}
                </Badge>
              ) : (
                <>
                  <span className="cifra">{r.alumnos_total}</span> alumnos ·{' '}
                  <span className="cifra">{r.varones}</span> varones,{' '}
                  <span className="cifra">{r.mujeres}</span> mujeres
                  {r.alumnos_nuevos > 0 && (
                    <>
                      {' · '}
                      <span className="text-naranja-600">
                        <span className="cifra">{r.alumnos_nuevos}</span> nuevos
                      </span>
                    </>
                  )}
                </>
              )}
            </p>
          </div>

          {editable(r) ? (
            <Button variant="ghost" size="sm" onClick={() => onEditar(r)}>
              <Pencil className="h-4 w-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">Editar</span>
            </Button>
          ) : (
            <span className="text-muted-foreground shrink-0 text-xs">
              fuera de plazo
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
