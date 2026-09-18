// REQ 6: historial de modificaciones de un registro.
//
// Las filas las escribe el trigger fn_auditar_registros, una por campo que
// efectivamente cambio. Aca solo se leen y se les agrega la etiqueta legible,
// que es cosa de la interfaz y no tiene por que estar guardada en la base.

import { error, errorDePostgres } from '@/lib/consultas';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';
import { ETIQUETAS_CAMPOS } from '@/lib/validacion';
import type { EntradaHistorial } from '@/lib/tipos';

/** En Next 16 los params de una ruta dinamica llegan como Promise. */
type Contexto = { params: Promise<{ id: string }> };

type FilaHistorial = Omit<EntradaHistorial, 'etiqueta_campo'>;

export async function GET(pedido: Request, { params }: Contexto) {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);

  const n = Number((await params).id);
  if (!Number.isInteger(n) || n <= 0) {
    return error('El identificador del registro no es válido.', 400);
  }

  const supabase = await clienteServidor();

  const { data: filas, error: fallo } = await supabase
    .from('registros_historial')
    .select(
      'id, registro_id, accion, campo, valor_anterior, valor_nuevo, ' +
      'usuario_id, usuario_nombre, fecha_hora',
    )
    .eq('registro_id', n)
    // Mas reciente primero: el id crece con el tiempo y desempata dos asientos
    // de la misma edicion, que comparten fecha_hora al milisegundo.
    .order('id', { ascending: false })
    .returns<FilaHistorial[]>();

  if (fallo) return errorDePostgres(fallo);

  // Un registro eliminado conserva su historial, asi que la ausencia de
  // asientos es la unica senal de que ese id no existio nunca.
  if (!filas || filas.length === 0) {
    const { data: registro, error: falloRegistro } = await supabase
      .from('v_revision')
      .select('id')
      .eq('id', n)
      .maybeSingle<{ id: number }>();

    if (falloRegistro) return errorDePostgres(falloRegistro);
    if (!registro) return error('No encontramos el registro que buscás.', 404);
  }

  const historial: EntradaHistorial[] = (filas ?? []).map((f) => ({
    ...f,
    etiqueta_campo: ETIQUETAS_CAMPOS[f.campo] ?? '',
  }));

  return Response.json({ historial });
}
