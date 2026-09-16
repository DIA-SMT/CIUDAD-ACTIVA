// REQ 7: alumnos por lugar y nivel de actividad de cada espacio.
// ultima_clase es la fecha de la ultima clase realizada en el espacio.

import { normalizarPorLugar, responderIndicador } from '../_compartido';

// Depende de la sesion y de los filtros del pedido: no se puede cachear.
export const dynamic = 'force-dynamic';

export async function GET(pedido: Request): Promise<Response> {
  return responderIndicador(pedido, {
    funcion: 'estadisticas_por_lugar',
    normalizar: normalizarPorLugar,
  });
}
