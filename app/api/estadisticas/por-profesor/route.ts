// REQ 7: clases por profesor y alumnos por profesor.

import { normalizarPorProfesor, responderIndicador } from '../_compartido';

// Depende de la sesion y de los filtros del pedido: no se puede cachear.
export const dynamic = 'force-dynamic';

export async function GET(pedido: Request): Promise<Response> {
  return responderIndicador(pedido, {
    funcion: 'estadisticas_por_profesor',
    normalizar: normalizarPorProfesor,
  });
}
