'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { REGLAS_PASSWORD, revisarPassword, traducirErrorAuth } from '@/lib/contrasenas';
import { clienteNavegador } from '@/lib/supabase/navegador';

/**
 * Cambio de contraseña desde la propia sesión.
 *
 * Pide la contraseña actual aunque la sesión ya esté abierta: sin eso, cualquiera
 * que encuentre la pantalla abierta en una computadora compartida podría
 * cambiarla y dejar afuera al dueño de la cuenta.
 */
export function DialogoPassword({ email, onCerrar }: { email: string; onCerrar: () => void }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    setError(null);

    const faltas = revisarPassword(nueva);
    if (!actual) {
      setError('Escribí tu contraseña actual.');
      return;
    }
    if (faltas.length > 0) {
      setError(`La contraseña nueva necesita ${faltas.join(', ')}.`);
      return;
    }
    if (nueva !== repetida) {
      setError('Las dos contraseñas nuevas no coinciden.');
      return;
    }
    if (nueva === actual) {
      setError('La contraseña nueva tiene que ser distinta de la actual.');
      return;
    }

    setGuardando(true);
    const supabase = clienteNavegador();

    // Supabase no verifica la contraseña actual al cambiarla, salvo que el
    // proyecto lo tenga configurado. Volver a ingresar con ella es la forma de
    // comprobarla, y de paso cumple con el "ingreso reciente" que pide Supabase
    // cuando está activado el cambio seguro de contraseña.
    const { error: falloIngreso } = await supabase.auth.signInWithPassword({
      email,
      password: actual,
    });

    if (falloIngreso) {
      setError(
        falloIngreso.message.toLowerCase().includes('invalid login credentials')
          ? 'La contraseña actual no es correcta.'
          : traducirErrorAuth(falloIngreso.message),
      );
      setGuardando(false);
      return;
    }

    const { error: falloCambio } = await supabase.auth.updateUser({
      password: nueva,
      // Sólo lo usa Supabase si el proyecto exige la contraseña actual; si no, la ignora.
      current_password: actual,
      // Si la Dirección la había restablecido, el cambio obligatorio ya no hace falta.
      data: { debe_cambiar_password: false },
    });

    if (falloCambio) {
      setError(traducirErrorAuth(falloCambio.message));
      setGuardando(false);
      return;
    }

    toast.success('Contraseña cambiada', {
      description: 'La próxima vez que ingreses, usá la nueva.',
    });
    onCerrar();
  }

  const faltas = nueva ? revisarPassword(nueva) : [];
  const coinciden = repetida.length > 0 && nueva === repetida;

  return (
    <Dialog open onOpenChange={(a) => !a && !guardando && onCerrar()}>
      <DialogContent>
        <form onSubmit={guardar} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Cambiar mi contraseña</DialogTitle>
            <DialogDescription>
              Para confirmar que sos vos, escribí primero la contraseña con la que ingresaste.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="p-actual">Contraseña actual</Label>
              <Input
                id="p-actual"
                type={verPassword ? 'text' : 'password'}
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-nueva">Contraseña nueva</Label>
              <Input
                id="p-nueva"
                type={verPassword ? 'text' : 'password'}
                value={nueva}
                onChange={(e) => setNueva(e.target.value)}
                autoComplete="new-password"
                aria-describedby="p-reglas"
                required
              />
              <p id="p-reglas" className="text-muted-foreground text-xs">
                {nueva.length === 0
                  ? REGLAS_PASSWORD
                  : faltas.length > 0
                    ? `Le falta: ${faltas.join(', ')}.`
                    : 'Cumple con lo pedido.'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-repetida">Repetí la nueva</Label>
              <Input
                id="p-repetida"
                type={verPassword ? 'text' : 'password'}
                value={repetida}
                onChange={(e) => setRepetida(e.target.value)}
                autoComplete="new-password"
                required
              />
              {repetida.length > 0 && !coinciden && (
                <p className="text-rojo-600 text-xs">Todavía no coinciden.</p>
              )}
            </div>

            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={verPassword}
                onChange={(e) => setVerPassword(e.target.checked)}
                className="accent-azul-700 h-4 w-4"
              />
              Ver lo que escribo
            </label>

            {error && (
              <Alert variant="destructive" aria-live="assertive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={guardando || !actual || faltas.length > 0 || !coinciden}
            >
              {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Cambiar la contraseña
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
