// Asistente del panel: responde preguntas sobre el programa en lenguaje natural.
//
// El modelo no consulta la base directamente ni escribe SQL: elige entre las
// herramientas de ./herramientas.ts, que son las mismas funciones que alimentan
// el tablero. Por eso una respuesta del asistente nunca puede contradecir un
// numero del panel, y no puede ver nada que el usuario no pueda ver.
//
// La respuesta incluye el detalle de que consultas se hicieron. En un sistema
// del que van a salir informes, saber de donde sale cada numero importa tanto
// como el numero.

import Anthropic from '@anthropic-ai/sdk';
import { error } from '@/lib/consultas';
import { hoyISO } from '@/lib/fechas';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';
import type { EstadoClase, Lugar, ProfesorOpcion } from '@/lib/tipos';
import {
  HERRAMIENTAS, filtrosDeHerramienta, parametrosDeIndicador,
} from './herramientas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODELO = 'claude-opus-5';
/** Tope de idas y vueltas con herramientas, por si una pregunta se enrosca. */
const MAX_PASOS = 8;
const MAX_MENSAJES = 24;

interface Consulta {
  herramienta: string;
  detalle: string;
}

function instrucciones(
  perfil: { nombre: string },
  catalogos: {
    profesores: ProfesorOpcion[];
    lugares: Pick<Lugar, 'id' | 'nombre'>[];
    estados: Pick<EstadoClase, 'codigo' | 'nombre'>[];
  },
): string {
  return `Sos el asistente del panel de "Ciudad Activa", el programa de gimnasia y actividad
física gratuita en plazas y parques de la Municipalidad de San Miguel de Tucumán, que
depende de la Dirección de Deportes y Recreación.

Estás hablando con ${perfil.nombre}, que administra el programa. Hoy es ${hoyISO()}.

QUÉ SON LOS DATOS
Cada registro es una clase dictada por un profesor en un espacio, un día. Guarda cuántos
alumnos hubo, cuántos varones y mujeres, cuántos eran nuevos, el estado de la clase y las
observaciones que escribió el profesor.

Definiciones que tenés que respetar, son las mismas que usa el tablero:
- "Clase realizada" es la que no está suspendida. "Clase registrada" son todas.
- Los alumnos, los promedios y la distribución por sexo se cuentan sólo sobre las realizadas.
- "Alumnos" es la suma de asistentes por clase, no personas distintas: alguien que va a
  veinte clases suma veinte. Si te preguntan cuánta gente participa, aclaralo.
- "Alumnos nuevos" es lo que el profesor marcó como incorporaciones esa clase.

CÓMO RESPONDER
- Nunca inventes ni estimes un número. Si no lo trajiste con una herramienta, no lo digas.
- Antes de responder cualquier cosa con cifras, consultá. Aunque parezca que ya lo sabés.
- Si la pregunta no aclara el período, usá todo el histórico y decí qué período tomaste.
- Contestá corto y directo, en español rioplatense. Primero el número que te pidieron,
  después el contexto si aporta. Sin preámbulos del tipo "según los datos consultados".
- Si un dato llama la atención, decilo. Ejemplo: si un espacio no tiene clases hace meses,
  o si un profesor tiene muchas suspensiones, mencionalo aunque no te lo hayan preguntado.
- Si la pregunta es ambigua, elegí la interpretación más razonable, respondé, y aclará en
  una línea qué interpretaste. No devuelvas la pregunta sin responder nada.
- Si lo que te piden no se puede saber con estos datos, decilo derecho y explicá qué falta.
- Para porcentajes y promedios usá los que ya vienen calculados, no los recalcules.
- Usá tablas de markdown cuando compares varias filas; para un dato suelto, una frase.

PROFESORES (usá el id, no el nombre, cuando filtres)
${catalogos.profesores.map((p) => `- ${p.nombre} → ${p.id}`).join('\n')}

ESPACIOS
${catalogos.lugares.map((l) => `- ${l.nombre} → ${l.id}`).join('\n')}

ESTADOS DE CLASE
${catalogos.estados.map((e) => `- ${e.nombre} → ${e.codigo}`).join('\n')}`;
}

export async function POST(pedido: Request): Promise<Response> {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);
  if (sesion.perfil.rol !== 'admin') {
    return error('El asistente está disponible para los administradores del programa.', 403);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return error(
      'El asistente no está configurado: falta ANTHROPIC_API_KEY en el servidor. ' +
      'El resto del panel funciona normalmente.',
      503,
    );
  }

  let cuerpo: { mensajes?: { rol: string; texto: string }[] };
  try {
    cuerpo = await pedido.json();
  } catch {
    return error('No se pudo leer el pedido.', 400);
  }

  const entrantes = (cuerpo.mensajes ?? [])
    .filter((m) => typeof m?.texto === 'string' && m.texto.trim())
    .slice(-MAX_MENSAJES);

  if (entrantes.length === 0) return error('Escribí una pregunta.', 400);

  const supabase = await clienteServidor();

  // Los catalogos van en el system prompt: el modelo necesita los ids para
  // filtrar, y asi se ahorra una llamada de herramienta en cada conversacion.
  const [profesores, lugares, estados] = await Promise.all([
    supabase.from('perfiles').select('id, nombre, cargo, email')
      .eq('activo', true).eq('dicta_clases', true).order('nombre')
      .returns<ProfesorOpcion[]>(),
    supabase.from('lugares').select('id, nombre')
      .eq('activo', true).order('orden')
      .returns<Pick<Lugar, 'id' | 'nombre'>[]>(),
    supabase.from('estados_clase').select('codigo, nombre')
      .eq('activo', true).order('orden')
      .returns<Pick<EstadoClase, 'codigo' | 'nombre'>[]>(),
  ]);

  const sistema = instrucciones(sesion.perfil, {
    profesores: profesores.data ?? [],
    lugares: lugares.data ?? [],
    estados: estados.data ?? [],
  });

  const anthropic = new Anthropic();
  const mensajes: Anthropic.MessageParam[] = entrantes.map((m) => ({
    role: m.rol === 'asistente' ? 'assistant' : 'user',
    content: m.texto,
  }));

  const consultas: Consulta[] = [];

  try {
    for (let paso = 0; paso < MAX_PASOS; paso += 1) {
      const respuesta = await anthropic.messages.create({
        model: MODELO,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
        tools: HERRAMIENTAS,
        messages: mensajes,
      });

      if (respuesta.stop_reason === 'refusal') {
        return Response.json({
          texto: 'No puedo responder eso. Probá con una pregunta sobre las clases del programa.',
          consultas,
        });
      }

      if (respuesta.stop_reason !== 'tool_use') {
        const texto = respuesta.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();

        return Response.json({
          texto: texto || 'No pude armar una respuesta. Probá preguntarlo de otra forma.',
          consultas,
        });
      }

      mensajes.push({ role: 'assistant', content: respuesta.content });

      // Las llamadas de una misma respuesta van juntas y vuelven en un solo
      // mensaje: partirlas hace que el modelo deje de pedirlas en paralelo.
      const pedidos = respuesta.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      const resultados = await Promise.all(
        pedidos.map(async (llamada): Promise<Anthropic.ToolResultBlockParam> => {
          const entrada = (llamada.input ?? {}) as Record<string, unknown>;
          try {
            if (llamada.name === 'consultar_indicadores') {
              const { funcion, parametros } = parametrosDeIndicador(entrada);
              const { data, error: fallo } = await supabase.rpc(funcion, parametros);
              if (fallo) throw new Error(fallo.message);

              consultas.push({
                herramienta: String(entrada.indicador),
                detalle: describir(entrada),
              });
              return {
                type: 'tool_result',
                tool_use_id: llamada.id,
                content: JSON.stringify(data ?? {}),
              };
            }

            if (llamada.name === 'listar_clases') {
              const f = filtrosDeHerramienta(entrada);
              const limite = Math.min(50, Math.max(1, Number(entrada.limite) || 10));
              const orden = String(entrada.orden ?? 'fecha_desc');

              let consulta = supabase
                .from('v_registros')
                .select('fecha, profesor_nombre, lugar_nombre, estado_nombre, alumnos_total,' +
                        ' varones, mujeres, alumnos_nuevos, observaciones');

              if (f.desde) consulta = consulta.gte('fecha', f.desde);
              if (f.hasta) consulta = consulta.lte('fecha', f.hasta);
              if (f.profesor_id) consulta = consulta.eq('profesor_id', f.profesor_id);
              if (f.lugar_id) consulta = consulta.eq('lugar_id', f.lugar_id);
              if (f.estado) consulta = consulta.eq('estado_codigo', f.estado);
              if (f.q) {
                const t = f.q.replace(/[,()]/g, ' ').trim();
                if (t) {
                  consulta = consulta.or(
                    `observaciones.ilike.*${t}*,profesor_nombre.ilike.*${t}*,lugar_nombre.ilike.*${t}*`,
                  );
                }
              }

              const columna = orden === 'alumnos_desc' ? 'alumnos_total'
                : orden === 'creado_desc' ? 'creado_en' : 'fecha';
              const { data, error: fallo } = await consulta
                .order(columna, { ascending: orden === 'fecha_asc' })
                .limit(limite);
              if (fallo) throw new Error(fallo.message);

              consultas.push({ herramienta: 'clases', detalle: describir(entrada) });
              return {
                type: 'tool_result',
                tool_use_id: llamada.id,
                content: JSON.stringify(data ?? []),
              };
            }

            throw new Error(`Herramienta desconocida: ${llamada.name}`);
          } catch (e) {
            // El error vuelve al modelo para que reformule, no rompe la respuesta.
            return {
              type: 'tool_result',
              tool_use_id: llamada.id,
              content: `No se pudo consultar: ${e instanceof Error ? e.message : 'error'}`,
              is_error: true,
            };
          }
        }),
      );

      mensajes.push({ role: 'user', content: resultados });
    }

    return Response.json({
      texto: 'La consulta se hizo muy larga. Probá acotarla, por ejemplo a un período o a un lugar.',
      consultas,
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return error('La clave del asistente no es válida. Revisá ANTHROPIC_API_KEY.', 503);
    }
    if (e instanceof Anthropic.RateLimitError) {
      return error('El asistente está saturado. Esperá unos segundos y volvé a preguntar.', 429);
    }
    console.error('[asistente]', e);
    return error('El asistente no pudo responder. Intentá de nuevo.', 500);
  }
}

/** Resume los filtros de una llamada, para mostrarle al admin de dónde salió el número. */
function describir(entrada: Record<string, unknown>): string {
  const partes: string[] = [];
  if (entrada.desde || entrada.hasta) {
    partes.push(`${entrada.desde ?? 'el inicio'} a ${entrada.hasta ?? 'hoy'}`);
  }
  if (entrada.lugar_id) partes.push('un lugar');
  if (entrada.profesor_id) partes.push('un profesor');
  if (entrada.estado) partes.push(`estado ${entrada.estado}`);
  if (entrada.q) partes.push(`texto «${entrada.q}»`);
  if (entrada.agrupar) partes.push(`por ${entrada.agrupar}`);
  return partes.length ? partes.join(' · ') : 'todo el período';
}
