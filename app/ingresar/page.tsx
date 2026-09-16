import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Marca } from '@/components/marca';
import { Skeleton } from '@/components/ui/skeleton';
import { FormularioIngreso } from './formulario-ingreso';

export const metadata: Metadata = { title: 'Ingresar' };

export default function Ingresar() {
  return (
    <main className="from-azul-50 flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b to-white px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Marca prioridad />
          <p className="text-muted-foreground text-sm text-balance">
            Registro de actividades · Municipalidad de San Miguel de Tucumán
          </p>
        </div>

        <div className="bg-card rounded-xl border p-6 shadow-sm sm:p-8">
          {/* useSearchParams obliga a un limite de Suspense en el App Router. */}
          <Suspense fallback={<Skeleton className="h-72 w-full" />}>
            <FormularioIngreso />
          </Suspense>
        </div>

        <p className="text-muted-foreground mt-6 text-center text-xs text-balance">
          ¿Olvidaste tu contraseña? La restablece el administrador del sistema desde el
          panel.
        </p>
      </div>
    </main>
  );
}
