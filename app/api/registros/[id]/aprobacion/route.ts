// Aprobar o rechazar una carga.
//
// Sólo la Dirección. Los indicadores cuentan únicamente lo aprobado, así que
// esta ruta es la que decide qué entra en los informes del programa.
//
// El cambio de estado lo registra el trigger tg_control_aprobacion (quién y
// cuándo) y queda asentado en el historial por el trigger de auditoría: acá no
// se escribe nada de eso a mano.

import { error, errorDePostgres } from '@/lib/consultas';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';
import type { Aprobacion, RegistroRevision } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

const MOTIVO_MAX = 500;

interface Cuerpo {
  decision?: string;
  motivo?: string;
}

export async function POST(
  pedido: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);
  if (sesion.perfil.rol !== 'admin') {
    return error('Sólo la Dirección puede aprobar o rechazar cargas.', 403);
  }

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return error('El registro no es válido.', 400);

  let cuerpo: Cuerpo;
  try {
    cuerpo = await pedido.json();
  } catch {
    return error('No se pudo leer el pedido.', 400);
  }

  const decision = String(cuerpo.decision ?? '').trim() as Aprobacion;
  if (decision !== 'aprobado' && decision !== 'rechazado' && decision !== 'pendiente') {
    return error('La decisión tiene que ser aprobado, rechazado o pendiente.', 422);
  }

  const motivo = String(cuerpo.motivo ?? '').trim().slice(0, MOTIVO_MAX);

  // Un rechazo sin motivo no le sirve al profesor: no sabe qué corregir.
  if (decision === 'rechazado' && !motivo) {
    return Response.json({
      error: 'Falta el motivo del rechazo.',
      errores: { motivo: 'Explicá por qué se rechaza: el profesor lo va a ver.' },
    }, { status: 422 });
  }

  const supabase = await clienteServidor();

  const { data, error: fallo } = await supabase
    .from('registros')
    .update({
      aprobacion: decision,
      motivo_rechazo: decision === 'rechazado' ? motivo : '',
    })
    .eq('id', id)
    .select('id');

  if (fallo) return errorDePostgres(fallo);

  // RLS devuelve cero filas en vez de un error cuando bloquea.
  if (!data || data.length === 0) {
    return error('No se encontró el registro, o no tenés permiso para revisarlo.', 404);
  }

  const { data: registro } = await supabase
    .from('v_revision')
    .select('*')
    .eq('id', id)
    .maybeSingle<RegistroRevision>();

  return Response.json({ registro });
}
