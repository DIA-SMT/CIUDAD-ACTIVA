import Image from 'next/image';

/**
 * Marca del sistema.
 *
 * El isotipo es el oficial de la Municipalidad de San Miguel de Tucumán, en
 * public/. Hay dos versiones y cada una es para un fondo:
 *   logoMuni-sm.png      isotipo a color, para fondos claros
 *   Logo_SMT_blanco.png  logo completo en blanco, para fondos oscuros
 */
export function Isotipo({
  className = 'h-9 w-9',
  prioridad = false,
}: {
  className?: string;
  prioridad?: boolean;
}) {
  return (
    <Image
      src="/logoMuni-sm.png"
      alt=""
      width={235}
      height={235}
      className={className}
      priority={prioridad}
      aria-hidden
    />
  );
}

export function Marca({
  compacta = false,
  prioridad = false,
}: {
  compacta?: boolean;
  prioridad?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Isotipo className={compacta ? 'h-9 w-9' : 'h-12 w-12'} prioridad={prioridad} />
      <div className="leading-tight">
        <p
          className={`text-azul-900 font-semibold tracking-tight ${
            compacta ? 'text-base' : 'text-xl'
          }`}
        >
          Ciudad Activa
        </p>
        <p className={`text-muted-foreground ${compacta ? 'text-[11px]' : 'text-xs'}`}>
          {compacta ? 'Deportes y Recreación' : 'Dirección de Deportes y Recreación'}
        </p>
      </div>
    </div>
  );
}

/** Pie institucional. Va al final de las pantallas con sesión. */
export function PieInstitucional() {
  return (
    <footer className="no-imprimir text-muted-foreground mt-auto border-t py-5 text-center text-xs">
      <p>Dirección de Deportes y Recreación</p>
      <p className="mt-0.5">Municipalidad de San Miguel de Tucumán</p>
    </footer>
  );
}
