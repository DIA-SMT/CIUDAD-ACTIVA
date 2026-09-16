/**
 * Marca del programa. El isotipo es una hoja con una figura en movimiento:
 * la plaza y la persona que se mueve, que es de lo que se trata Ciudad Activa.
 * Va en SVG en linea para no depender de ningun archivo remoto.
 */
export function Isotipo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role="img"
      aria-label="Ciudad Activa"
      fill="none"
    >
      {/* hoja */}
      <path
        d="M20 37C10 34 5 26 6 15c0-1 1-2 2-2 11-1 19 4 22 14 1 4 1 7 0 10-3-1-7-1-10 0Z"
        fill="currentColor"
        opacity="0.22"
      />
      {/* figura en movimiento */}
      <circle cx="24.5" cy="9.5" r="3.5" fill="currentColor" />
      <path
        d="M25 14c-3 1-5 3-6 6l-3 5m9-11c3 1 5 3 6 6m-6-6-1 8 5 5 1 6m-6-11-6 4"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Marca({ compacta = false }: { compacta?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Isotipo className={compacta ? 'text-verde-700 h-8 w-8' : 'text-verde-700 h-11 w-11'} />
      <div className="leading-tight">
        <p
          className={`text-verde-900 font-semibold tracking-tight ${
            compacta ? 'text-base' : 'text-xl'
          }`}
        >
          Ciudad Activa
        </p>
        {!compacta && (
          <p className="text-muted-foreground text-xs">
            Dirección de Deportes y Recreación
          </p>
        )}
      </div>
    </div>
  );
}
