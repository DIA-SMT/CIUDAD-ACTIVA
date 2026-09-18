'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

/**
 * La contraseña generada se muestra una sola vez.
 * No se guarda en ningún lado ni se puede volver a consultar: si se pierde, el
 * camino es generar otra.
 */
export function ClaveGenerada({
  clave, nombre, onCerrar,
}: {
  clave: string;
  nombre: string;
  onCerrar: () => void;
}) {
  const [copiada, setCopiada] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(clave);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      toast.error('No se pudo copiar. Anotala a mano.');
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contraseña de {nombre}</DialogTitle>
          <DialogDescription>
            Anotala o copiala ahora: no se vuelve a mostrar. Cuando {nombre} ingrese, el
            sistema le va a pedir que la cambie por una propia.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted flex items-center gap-3 rounded-lg border p-4">
          <code className="flex-1 font-mono text-lg tracking-wider select-all">{clave}</code>
          <Button variant="outline" size="sm" onClick={() => void copiar()}>
            {copiada ? (
              <Check className="text-verde-600 h-4 w-4" aria-hidden />
            ) : (
              <Copy className="h-4 w-4" aria-hidden />
            )}
            {copiada ? 'Copiada' : 'Copiar'}
          </Button>
        </div>

        <DialogFooter>
          <Button onClick={onCerrar}>Ya la anoté</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
