// REQ 7: distribucion por sexo, total y periodo a periodo.
// Se calcula solo sobre clases realizadas: una clase suspendida no tuvo
// asistentes y no debe diluir ninguna proporcion.

import { normalizarSexo, responderIndicador } from '../_compartido';

// Depende de la sesion y de los filtros del pedido: no se puede cachear.
export const dynamic = 'force-dynamic';

export async function GET(pedido: Request): Promise<Response> {
  return responderIndicador(pedido, {
    funcion: 'estadisticas_sexo',
    // La serie por periodo tiene que usar el mismo corte que el resto del
    // tablero. Sin esto la funcion cae en su default mensual y el grafico
    // quedaria en meses mientras el de al lado muestra dias.
    agrupa: true,
    normalizar: normalizarSexo,
  });
}
