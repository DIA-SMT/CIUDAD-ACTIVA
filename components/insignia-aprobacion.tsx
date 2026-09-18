import { Badge } from '@/components/ui/badge';
import type { Aprobacion } from '@/lib/tipos';

const ESTILOS: Record<Aprobacion, { texto: string; clase: string }> = {
  pendiente: {
    texto: 'Pendiente',
    clase: 'border-amarillo-600/40 bg-amarillo-500/15 text-amarillo-600',
  },
  aprobado: {
    texto: 'Aprobada',
    clase: 'border-verde-600/30 bg-verde-600/10 text-verde-600',
  },
  rechazado: {
    texto: 'Rechazada',
    clase: 'border-rojo-600/30 bg-rojo-600/10 text-rojo-600',
  },
};

export function InsigniaAprobacion({ estado }: { estado: Aprobacion }) {
  const { texto, clase } = ESTILOS[estado] ?? ESTILOS.pendiente;
  return (
    <Badge variant="outline" className={clase}>
      {texto}
    </Badge>
  );
}
