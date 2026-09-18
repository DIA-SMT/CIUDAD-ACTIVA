'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { traerJSON, useRecurso } from '@/lib/usar-recurso';

interface Parametro {
  clave: string;
  valor: string;
  descripcion: string;
  etiqueta: string;
  min: number;
  max: number;
  unidad: string;
}

function Campo({ p, onGuardado }: { p: Parametro; onGuardado: () => void }) {
  const [valor, setValor] = useState(p.valor);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cambio = valor.trim() !== p.valor.trim();

  async function guardar() {
    setGuardando(true);
    setError(null);
    const r = await fetch('/api/admin/parametros', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clave: p.clave, valor }),
    });
    const d = await r.json().catch(() => null);
    setGuardando(false);

    if (!r.ok) {
      setError(d?.errores?.valor ?? d?.error ?? 'No se pudo guardar.');
      return;
    }
    toast.success('Configuración guardada');
    onGuardado();
  }

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <Label htmlFor={`p-${p.clave}`} className="text-sm font-medium">
        {p.etiqueta}
      </Label>
      <p className="text-muted-foreground text-sm">{p.descripcion}</p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Input
          id={`p-${p.clave}`}
          type="number"
          inputMode="numeric"
          min={p.min}
          max={p.max}
          value={valor}
          onChange={(e) => { setValor(e.target.value); setError(null); }}
          className="cifra w-28"
          aria-invalid={Boolean(error)}
        />
        <span className="text-muted-foreground text-sm">{p.unidad}</span>
        <Button size="sm" onClick={() => void guardar()} disabled={!cambio || guardando}>
          {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Guardar
        </Button>
        {cambio && !guardando && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setValor(p.valor); setError(null); }}
          >
            Deshacer
          </Button>
        )}
      </div>

      {error && <p className="text-rojo-600 text-sm">{error}</p>}
      <p className="text-muted-foreground text-xs">
        Entre {p.min} y {p.max}.
      </p>
    </div>
  );
}

export function Configuracion() {
  const { datos, error, refrescar } = useRecurso(
    '/api/admin/parametros',
    () => traerJSON<{ parametros: Parametro[] }>('/api/admin/parametros'),
  );

  if (error) {
    return (
      <p className="text-rojo-600 py-8 text-center text-sm">
        No se pudo cargar la configuración.
      </p>
    );
  }

  if (!datos) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm text-balance">
        Reglas del sistema que podés cambiar sin pedirle nada a nadie. El cambio vale
        desde que lo guardás.
      </p>

      {datos.parametros.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No hay parámetros configurables.
        </p>
      ) : (
        <div className="space-y-3">
          {datos.parametros.map((p) => (
            <Campo key={p.clave} p={p} onGuardado={refrescar} />
          ))}
        </div>
      )}

      <div className="bg-muted/50 rounded-lg border p-4 text-sm">
        <p className="font-medium">Lo que no se cambia desde acá</p>
        <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
          <li>
            Los <strong>estados de clase</strong> son cuatro fijos: normal, suspendida por
            clima, por feriado y por otro motivo. Agregar uno nuevo requiere tocar el sistema.
          </li>
          <li>
            El <strong>tope de alumnos por clase</strong> (2.000) y la{' '}
            <strong>antigüedad máxima de una carga</strong> (365 días) son controles de
            cordura pensados para evitar errores de tipeo.
          </li>
          <li>
            Los <strong>espacios</strong> y las <strong>personas</strong> se administran en
            las otras solapas de esta sección.
          </li>
        </ul>
      </div>
    </div>
  );
}
