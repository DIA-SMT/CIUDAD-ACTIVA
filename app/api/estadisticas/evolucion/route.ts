// REQ 7: evolucion de la matricula y de la participacion por periodo.
// Serie en orden cronologico ascendente; un periodo sin clases no se inventa.
//
// Acepta ademas "agrupar" en la query: dia | semana | mes (mes por defecto).

import { normalizarEvolucion, responderIndicador } from '../_compartido';

// Depende de la sesion y de los filtros del pedido: no se puede cachear.
export const dynamic = 'force-dynamic';

export async function GET(pedido: Request): Promise<Response> {
  return responderIndicador(pedido, {
    funcion: 'estadisticas_evolucion',
    agrupa: true,
    normalizar: normalizarEvolucion,
  });
}
