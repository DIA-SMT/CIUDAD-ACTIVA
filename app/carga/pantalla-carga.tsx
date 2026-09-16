'use client';

import { useRef, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Catalogos, Perfil, Registro } from '@/lib/tipos';
import { FormularioCarga } from './formulario-carga';
import { UltimasCargas } from './ultimas-cargas';

export function PantallaCarga({
  perfil,
  catalogos,
}: {
  perfil: Perfil;
  catalogos: Catalogos;
}) {
  const [editando, setEditando] = useState<Registro | null>(null);
  const [recargar, setRecargar] = useState(0);
  const tarjeta = useRef<HTMLDivElement>(null);

  function editar(r: Registro) {
    setEditando(r);
    tarjeta.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6">
      <Card ref={tarjeta}>
        <CardHeader>
          <CardTitle>
            {editando ? 'Corregir la clase cargada' : 'Registrar una clase'}
          </CardTitle>
          {!editando && (
            <p className="text-muted-foreground text-sm">
              Cargá la clase del día. Si te equivocaste, podés corregirla hasta 7 días
              después.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <FormularioCarga
            // Remonta el formulario al pasar de alta a edicion: el estado
            // arranca del registro correcto sin sincronizarlo con un efecto.
            key={editando?.id ?? 'nuevo'}
            perfil={perfil}
            catalogos={catalogos}
            editando={editando}
            onGuardado={() => setRecargar((n) => n + 1)}
            onCancelar={() => setEditando(null)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mis últimas cargas</CardTitle>
        </CardHeader>
        <CardContent>
          <UltimasCargas perfil={perfil} recargar={recargar} onEditar={editar} />
        </CardContent>
      </Card>
    </div>
  );
}
