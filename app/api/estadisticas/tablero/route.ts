// REQ 7: todo el panel en una sola llamada.
// La funcion SQL arma las seis secciones sobre el mismo subconjunto filtrado,
// asi los cortes cierran entre si y el panel no queda mostrando numeros de dos
// consultas distintas.
//
// Acepta ademas "agrupar" en la query: dia | semana | mes (mes por defecto).

import { normalizarTablero, responderIndicador } from '../_compartido';

// Depende de la sesion y de los filtros del pedido: no se puede cachear.
export const dynamic = 'force-dynamic';

export async function GET(pedido: Request): Promise<Response> {
  return responderIndicador(pedido, {
    funcion: 'estadisticas_tablero',
    agrupa: true,
    normalizar: normalizarTablero,
  });
}
