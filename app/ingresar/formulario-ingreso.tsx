'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { REGLAS_PASSWORD, revisarPassword, traducirErrorAuth } from '@/lib/contrasenas';
import { clienteNavegador } from '@/lib/supabase/navegador';

/**
 * A dónde va después de entrar.
 *
 * Sin un ?volver válido manda a la raíz, que es un Server Component y decide
 * según el rol leyéndolo de `perfiles`. Antes esto miraba el rol del
 * user_metadata de Auth, que es una segunda copia: al cambiarle el rol a
 * alguien desde Gestión quedaba desactualizada y la persona entraba como admin
 * pero caía en el formulario de carga. Una sola fuente de verdad.
 *
 * Sólo rutas internas: un ?volver=https://... sería un redirect abierto.
 */
function destinoSeguro(volver: string | null): string {
  if (volver && volver.startsWith('/') && !volver.startsWith('//')) return volver;
  return '/';
}

type Paso = 'ingreso' | 'cambio';

export function FormularioIngreso() {
  const router = useRouter();
  const parametros = useSearchParams();
  const supabase = clienteNavegador();

  const [paso, setPaso] = useState<Paso>('ingreso');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [aviso, setAviso] = useState<string | null>(
    parametros.get('vencida') ? 'Tu sesión expiró. Volvé a ingresar.' : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const campoNueva = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (paso === 'cambio') campoNueva.current?.focus();
  }, [paso]);

  async function ingresar(evento: React.FormEvent) {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    setCargando(true);

    const { data, error: fallo } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (fallo) {
      setError(traducirErrorAuth(fallo.message));
      setCargando(false);
      return;
    }

    // La primera vez no se entra de largo: hay que cambiar la contraseña que
    // asignó el administrador, que es la misma para todos. Esto sí vive en el
    // metadata de Auth, porque es una propiedad de la credencial.
    if (data.user?.user_metadata?.debe_cambiar_password) {
      setPaso('cambio');
      setCargando(false);
      return;
    }

    router.replace(destinoSeguro(parametros.get('volver')));
  }

  async function cambiar(evento: React.FormEvent) {
    evento.preventDefault();
    setError(null);

    const faltas = revisarPassword(nueva);
    if (faltas.length > 0) {
      setError(`La contraseña necesita ${faltas.join(', ')}.`);
      return;
    }
    if (nueva !== repetida) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }

    setCargando(true);
    const { error: fallo } = await supabase.auth.updateUser({
      password: nueva,
      data: { debe_cambiar_password: false },
    });

    if (fallo) {
      setError(traducirErrorAuth(fallo.message));
      setCargando(false);
      return;
    }

    router.replace(destinoSeguro(parametros.get('volver')));
  }

  const faltas = nueva ? revisarPassword(nueva) : [];
  const coinciden = repetida.length > 0 && nueva === repetida;

  if (paso === 'cambio') {
    return (
      <form onSubmit={cambiar} className="space-y-5" noValidate>
        <div className="bg-azul-50 border-azul-100 flex gap-3 rounded-lg border p-4">
          <ShieldCheck className="text-azul-700 mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="text-azul-900 text-sm">
            <p className="font-medium">Elegí tu contraseña</p>
            <p className="text-azul-900/80 mt-1">
              Entraste con la contraseña que asignó la Dirección, que es la misma para
              todos. Poné una tuya para seguir.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="nueva">Contraseña nueva</Label>
          <Input
            id="nueva"
            ref={campoNueva}
            type={verPassword ? 'text' : 'password'}
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            autoComplete="new-password"
            aria-describedby="reglas"
            required
          />
          <p id="reglas" className="text-muted-foreground text-xs">
            {nueva.length === 0
              ? REGLAS_PASSWORD
              : faltas.length > 0
                ? `Le falta: ${faltas.join(', ')}.`
                : 'Cumple con lo pedido.'}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="repetida">Repetila</Label>
          <Input
            id="repetida"
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

        <Button
          type="submit"
          className="h-11 w-full"
          disabled={cargando || faltas.length > 0 || !coinciden}
        >
          {cargando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Guardar y entrar
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={ingresar} className="space-y-5" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          inputMode="email"
          placeholder="tucorreo@ejemplo.com"
          required
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <div className="relative">
          <Input
            id="password"
            type={verPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="pr-12"
            required
          />
          <button
            type="button"
            onClick={() => setVerPassword((v) => !v)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md focus-visible:ring-2 focus-visible:outline-none"
            aria-label={verPassword ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
          >
            {verPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden />
            ) : (
              <Eye className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      </div>

      <div aria-live="polite">
        {aviso && !error && (
          <Alert>
            <AlertDescription>{aviso}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <Button type="submit" className="h-11 w-full" disabled={cargando}>
        {cargando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Ingresar
      </Button>
    </form>
  );
}
