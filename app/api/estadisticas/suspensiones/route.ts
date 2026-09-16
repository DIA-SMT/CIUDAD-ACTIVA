// REQ 7: cantidad y porcentaje de clases suspendidas, motivos y detalle.
// El detalle trae las observaciones, que es donde el profesor escribe el motivo
// concreto de la suspension.

import { normalizarSuspensiones, responderIndicador } from '../_compartido';

// Depende de la sesion y de los filtros del pedido: no se puede cachear.
export const dynamic = 'force-dynamic';

export async function GET(pedido: Request): Promise<Response> {
  return responderIndicador(pedido, {
    funcion: 'estadisticas_suspensiones',
    normalizar: normalizarSuspensiones,
  });
}
