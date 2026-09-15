// Utilidades de fecha en hora local, sin dependencias.
// Todas las fechas de negocio se guardan como texto 'YYYY-MM-DD' y los sellos
// de tiempo como 'YYYY-MM-DD HH:MM:SS', para que SQLite pueda ordenarlos y
// filtrarlos con comparaciones de texto.

const dosDigitos = (n) => String(n).padStart(2, '0');

/** Fecha local en formato YYYY-MM-DD. */
export function hoyISO(d = new Date()) {
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
}

/** Sello de tiempo local en formato YYYY-MM-DD HH:MM:SS. */
export function ahora(d = new Date()) {
  return `${hoyISO(d)} ${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}:${dosDigitos(d.getSeconds())}`;
}

/** Sello de tiempo local desplazado en horas (para vencimiento de sesiones). */
export function ahoraMasHoras(horas) {
  return ahora(new Date(Date.now() + horas * 3600_000));
}

/** true si el texto es una fecha calendaria valida en formato YYYY-MM-DD. */
export function esFechaISO(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [a, m, d] = valor.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(a, m, 0).getDate();
}

/** Diferencia en dias enteros entre dos fechas ISO (b - a). */
export function diasEntre(aISO, bISO) {
  const a = new Date(`${aISO}T00:00:00`);
  const b = new Date(`${bISO}T00:00:00`);
  return Math.round((b - a) / 86_400_000);
}

/** Primer dia del mes n meses atras, en ISO. Sirve para los filtros rapidos. */
export function mesesAtras(n, d = new Date()) {
  return hoyISO(new Date(d.getFullYear(), d.getMonth() - n, 1));
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** '2026-09' -> 'septiembre 2026'. Para las etiquetas de los graficos. */
export function periodoLegible(periodo) {
  const [a, m] = String(periodo).split('-').map(Number);
  if (!a || !m) return String(periodo);
  return `${MESES[m - 1]} ${a}`;
}
