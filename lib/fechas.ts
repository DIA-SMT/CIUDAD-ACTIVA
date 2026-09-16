// Utilidades de fecha en hora local, sin dependencias.
// Las fechas de negocio viajan como texto 'YYYY-MM-DD': es lo que espera
// Postgres para un date y lo que usa el <input type="date">.

const dosDigitos = (n: number) => String(n).padStart(2, '0');

/** Fecha local en formato YYYY-MM-DD. */
export function hoyISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
}

/** true si el texto es una fecha calendaria valida en formato YYYY-MM-DD. */
export function esFechaISO(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [a, m, d] = valor.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(a, m, 0).getDate();
}

/** Diferencia en dias enteros entre dos fechas ISO (b - a). */
export function diasEntre(aISO: string, bISO: string): number {
  const a = new Date(`${aISO}T00:00:00`);
  const b = new Date(`${bISO}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Primer dia del mes n meses atras. Alimenta los atajos de filtro del panel. */
export function mesesAtras(n: number, d: Date = new Date()): string {
  return hoyISO(new Date(d.getFullYear(), d.getMonth() - n, 1));
}

/** Primer dia del anio en curso. */
export function inicioDeAnio(d: Date = new Date()): string {
  return hoyISO(new Date(d.getFullYear(), 0, 1));
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;

/** '2026-09' -> 'septiembre 2026'. Etiquetas de los graficos. */
export function periodoLegible(periodo: string): string {
  const texto = String(periodo);

  // Semana ISO: '2026-W37'
  const semana = texto.match(/^(\d{4})-W(\d{2})$/);
  if (semana) return `sem. ${Number(semana[2])} de ${semana[1]}`;

  const [a, m, d] = texto.split('-').map(Number);
  if (a && m && d) return `${d}/${dosDigitos(m)}`;
  if (a && m) return `${MESES[m - 1]} ${a}`;
  return texto;
}

const NF = new Intl.NumberFormat('es-AR');

export const fmt = {
  numero: (n: number | null | undefined) => NF.format(Number(n) || 0),
  porcentaje: (n: number | null | undefined) =>
    `${(Number(n) || 0).toFixed(1).replace('.', ',')} %`,
  decimal: (n: number | null | undefined) => (Number(n) || 0).toFixed(1).replace('.', ','),

  /** '2026-09-08' -> '08/09/2026' */
  fecha: (iso: string | null | undefined) => {
    if (!iso) return '';
    const [a, m, d] = String(iso).slice(0, 10).split('-');
    return a && m && d ? `${d}/${m}/${a}` : String(iso);
  },

  /** Marca de tiempo de Postgres -> '08/09/2026 19:56' */
  fechaHora: (v: string | null | undefined) => {
    if (!v) return '';
    const f = new Date(v);
    if (Number.isNaN(f.getTime())) return String(v);
    return `${dosDigitos(f.getDate())}/${dosDigitos(f.getMonth() + 1)}/${f.getFullYear()} ` +
      `${dosDigitos(f.getHours())}:${dosDigitos(f.getMinutes())}`;
  },
};
