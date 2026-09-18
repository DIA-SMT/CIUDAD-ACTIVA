// Parámetros del sistema.
//
// Son las reglas que la Dirección puede querer cambiar sin pedirle nada a
// nadie. Hasta ahora vivían sólo en la tabla `parametros` y había que entrar a
// Supabase para tocarlas, que es justamente lo que no debería hacer falta.

import { error, errorDePostgres } from '@/lib/consultas';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

interface Parametro {
  clave: string;
  valor: string;
  descripcion: string;
}

/**
 * Qué se puede editar y con qué límites. Fuera de esta lista no se toca nada:
 * la tabla podría tener parámetros internos que no son para la interfaz.
 */
const EDITABLES: Record<string, { etiqueta: string; min: number; max: number; unidad: string }> = {
  ventana_edicion_dias: {
    etiqueta: 'Días para que un profesor corrija su propia carga',
    min: 0,
    max: 90,
    unidad: 'días',
  },
};

export async function GET(): Promise<Response> {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);
  if (sesion.perfil.rol !== 'admin') {
    return error('Sólo la Dirección puede ver la configuración.', 403);
  }

  const supabase = await clienteServidor();
  const { data, error: fallo } = await supabase
    .from('parametros')
    .select('clave, valor, descripcion')
    .order('clave')
    .returns<Parametro[]>();

  if (fallo) return errorDePostgres(fallo);

  const parametros = (data ?? [])
    .filter((p) => p.clave in EDITABLES)
    .map((p) => ({ ...p, ...EDITABLES[p.clave] }));

  return Response.json({ parametros });
}

export async function PATCH(pedido: Request): Promise<Response> {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);
  if (sesion.perfil.rol !== 'admin') {
    return error('Sólo la Dirección puede cambiar la configuración.', 403);
  }

  let cuerpo: { clave?: string; valor?: string | number };
  try {
    cuerpo = await pedido.json();
  } catch {
    return error('No se pudo leer el pedido.', 400);
  }

  const clave = String(cuerpo.clave ?? '').trim();
  const regla = EDITABLES[clave];
  if (!regla) return error('Ese parámetro no se puede editar desde acá.', 422);

  const valor = Number(cuerpo.valor);
  if (!Number.isInteger(valor) || valor < regla.min || valor > regla.max) {
    return Response.json({
      error: 'El valor no es válido.',
      errores: {
        valor: `Tiene que ser un número entero entre ${regla.min} y ${regla.max}.`,
      },
    }, { status: 422 });
  }

  const supabase = await clienteServidor();
  const { data, error: fallo } = await supabase
    .from('parametros')
    .update({ valor: String(valor) })
    .eq('clave', clave)
    .select('clave, valor');

  if (fallo) return errorDePostgres(fallo);
  if (!data || data.length === 0) {
    return error('No se encontró el parámetro, o no tenés permiso para cambiarlo.', 404);
  }

  return Response.json({ parametro: data[0] });
}
