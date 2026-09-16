// REQ 7: indicadores generales del subconjunto filtrado.
// Clases realizadas y suspendidas, alumnos, alumnos nuevos, distribucion por
// sexo, promedio por clase y extremos del periodo.

import { normalizarResumen, responderIndicador } from '../_compartido';

// Depende de la sesion y de los filtros del pedido: no se puede cachear.
export const dynamic = 'force-dynamic';

export async function GET(pedido: Request): Promise<Response> {
  return responderIndicador(pedido, {
    funcion: 'estadisticas_resumen',
    normalizar: normalizarResumen,
  });
}
