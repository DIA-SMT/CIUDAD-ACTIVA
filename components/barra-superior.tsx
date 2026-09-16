'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, ClipboardList, LogOut } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Marca } from '@/components/marca';
import { clienteNavegador } from '@/lib/supabase/navegador';
import type { Perfil } from '@/lib/tipos';

export function BarraSuperior({
  perfil,
  actual,
}: {
  perfil: Perfil;
  actual: 'carga' | 'panel';
}) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    await clienteNavegador().auth.signOut();
    // refresh() ademas limpia la cache del router, para que la pantalla
    // anterior no quede en memoria si alguien vuelve con el boton atras.
    router.replace('/ingresar');
    router.refresh();
  }

  const esAdmin = perfil.rol === 'admin';

  return (
    <header className="bg-card no-imprimir sticky top-0 z-30 border-b">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <Marca compacta />

        <nav className="ml-auto flex items-center gap-1">
          {/* Base UI no tiene asChild: al enlace se le aplican las clases del boton. */}
          {actual !== 'carga' && (
            <Link href="/carga" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <ClipboardList className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Cargar clase</span>
            </Link>
          )}

          {/* Un profesor tambien entra al panel, pero en modo consulta. */}
          {actual !== 'panel' && (
            <Link href="/panel" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <BarChart3 className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">
                {esAdmin ? 'Panel' : 'Estadísticas'}
              </span>
            </Link>
          )}

          <div className="mx-2 hidden text-right leading-tight sm:block">
            <p className="text-sm font-medium">{perfil.nombre}</p>
            <p className="text-muted-foreground text-xs">
              {esAdmin ? 'Administrador' : perfil.cargo}
            </p>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={salir}
            disabled={saliendo}
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </nav>
      </div>
    </header>
  );
}
