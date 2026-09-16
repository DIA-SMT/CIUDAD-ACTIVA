'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clienteNavegador } from '@/lib/supabase/navegador';

/** Supabase contesta en ingles; el profesor no tiene por que leer eso. */
function traducir(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'El correo o la contraseña no son correctos.';
  }
  if (m.includes('email not confirmed')) {
    return 'Tu cuenta todavía no está confirmada. Avisale al administrador del sistema.';
  }
  if (m.includes('too many requests') || m.includes('rate limit')) {
    return 'Demasiados intentos seguidos. Esperá un momento y volvé a probar.';
  }
  if (m.includes('user not found')) return 'El correo o la contraseña no son correctos.';
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'No se pudo conectar. Revisá tu conexión a internet.';
  }
  if (m.includes('should be different')) {
    return 'La contraseña nueva tiene que ser distinta de la actual.';
  }
  return mensaje;
}

/** Mismas reglas que pide el sistema en el cambio obligatorio. */
function revisarPassword(p: string): string[] {
  const faltas: string[] = [];
  if (p.length < 8) faltas.push('al menos 8 caracteres');
  if (!/[a-zA-Z]/.test(p)) faltas.push('al menos una letra');
  if (!/[0-9]/.test(p)) faltas.push('al menos un número');
  return faltas;
}

/** Sólo rutas internas: un ?volver=https://... sería un redirect abierto. */
function destinoSeguro(volver: string | null, rol: string): string {
  if (volver && volver.startsWith('/') && !volver.startsWith('//')) return volver;
  return rol === 'admin' ? '/panel' : '/carga';
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
  const [rol, setRol] = useState('profesor');
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
      setError(traducir(fallo.message));
      setCargando(false);
      return;
    }

    const rolUsuario = String(data.user?.user_metadata?.rol ?? 'profesor');
    setRol(rolUsuario);

    // La primera vez no se entra de largo: hay que cambiar la contraseña que
    // asigno el administrador, que es la misma para todos.
    if (data.user?.user_metadata?.debe_cambiar_password) {
      setPaso('cambio');
      setCargando(false);
      return;
    }

    router.replace(destinoSeguro(parametros.get('volver'), rolUsuario));
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
      setError(traducir(fallo.message));
      setCargando(false);
      return;
    }

    router.replace(destinoSeguro(parametros.get('volver'), rol));
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
              ? 'Al menos 8 caracteres, con una letra y un número.'
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
