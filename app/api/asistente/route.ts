// Asistente del panel: responde preguntas sobre el programa en lenguaje natural.
//
// Va contra OpenRouter, que expone una API compatible con la de OpenAI. El
// modelo se elige con OPENROUTER_MODEL, asi que cambiarlo no toca el codigo.
//
// El modelo no consulta la base directamente ni escribe SQL: elige entre las
// herramientas de ./herramientas.ts, que son las mismas funciones que alimentan
// el tablero. Por eso una respuesta del asistente nunca puede contradecir un
// numero del panel, y no puede ver nada que el usuario no pueda ver.
//
// La respuesta incluye el detalle de que consultas se hicieron. En un sistema
// del que van a salir informes, saber de donde sale cada numero importa tanto
// como el numero.

import OpenAI from 'openai';
import { error } from '@/lib/consultas';
import { hoyISO } from '@/lib/fechas';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';
import type { EstadoClase, Lugar, ProfesorOpcion } from '@/lib/tipos';
import {
  HERRAMIENTAS, argumentosDe, filtrosDeHerramienta, parametrosDeIndicador,
} from './herramientas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODELO_POR_DEFECTO = 'openai/gpt-4o-mini';
/** Tope de idas y vueltas con herramientas, por si una pregunta se enrosca. */
const MAX_PASOS = 6;
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
- Sólo entran las clases APROBADAS por la Dirección. Una carga que todavía
  espera revisión, o que fue rechazada, no está en ningún número que consultes.
  Si te preguntan por algo muy reciente y aparece poco o nada, puede ser que
  esté esperando aprobación: decilo como posible explicación.
- "Clase realizada" es la que no está suspendida. "Clase registrada" son todas.
- Los alumnos, los promedios y la distribución por sexo se cuentan sólo sobre las realizadas.
- "Alumnos" es la suma de asistentes por clase, no personas distintas: alguien que va a
  veinte clases suma veinte. Si te preguntan cuánta gente participa, aclaralo.
- "Alumnos nuevos" es lo que el profesor marcó como incorporaciones esa clase.

CÓMO RESPONDER
- Nunca inventes ni estimes un número. Si no lo trajiste con una herramienta, no lo digas.
- Antes de responder cualquier cosa con cifras, consultá. Aunque creas que ya lo sabés.
- Si la pregunta no aclara el período, usá todo el histórico y decí qué período tomaste.
- Contestá corto y directo, en español rioplatense. Primero el número que te pidieron,
  después el contexto si aporta. Sin preámbulos del tipo "según los datos consultados".
- Si un dato llama la atención, decilo. Por ejemplo: si un espacio no tiene clases hace
  meses, o si un profesor tiene muchas suspensiones, mencionalo aunque no lo pregunten.
- Si la pregunta es ambigua, elegí la interpretación más razonable, respondé, y aclará en
  una línea qué interpretaste. No devuelvas la pregunta sin responder nada.
- Si lo que piden no se puede saber con estos datos, decilo derecho y explicá qué falta.
- Para porcentajes y promedios usá los que ya vienen calculados, no los recalcules.
- Escribí los números como se escriben acá: coma decimal y punto de miles (40,6 y 1.250).
- Usá tablas de markdown cuando compares varias filas; para un dato suelto, una frase.

OJO CON LO QUE NO APARECE
"por_lugar" y "por_profesor" sólo devuelven los que tuvieron al menos una clase en el
período consultado. Un espacio sin ninguna clase no viene en la lista: no es que tenga
cero, es que no está. Si te preguntan qué espacios o qué profesores no tuvieron
actividad, compará lo que devuelve la herramienta contra las listas completas de acá
abajo y respondé con los que faltan. Nunca digas que todos tuvieron actividad sin
haber hecho esa comparación.

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

  const clave = process.env.OPENROUTER_API_KEY;
  if (!clave) {
    return error(
      'El asistente no está configurado: falta OPENROUTER_API_KEY en el servidor. ' +
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

  // Los catalogos van en las instrucciones: el modelo necesita los ids para
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

  const cliente = new OpenAI({
    apiKey: clave,
    baseURL: 'https://openrouter.ai/api/v1',
    // OpenRouter usa estas cabeceras para atribuir el consumo a la aplicacion.
    defaultHeaders: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_SITIO_URL ?? 'http://localhost:3000',
      'X-Title': 'Ciudad Activa',
    },
  });

  const modelo = process.env.OPENROUTER_MODEL?.trim() || MODELO_POR_DEFECTO;

  const mensajes: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: instrucciones(sesion.perfil, {
        profesores: profesores.data ?? [],
        lugares: lugares.data ?? [],
        estados: estados.data ?? [],
      }),
    },
    ...entrantes.map((m) => ({
      role: (m.rol === 'asistente' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.texto,
    })),
  ];

  const consultas: Consulta[] = [];

  try {
    for (let paso = 0; paso < MAX_PASOS; paso += 1) {
      const respuesta = await cliente.chat.completions.create({
        model: modelo,
        messages: mensajes,
        tools: HERRAMIENTAS,
        // Determinista: la misma pregunta sobre los mismos datos tiene que dar
        // la misma respuesta. Es un sistema del que salen informes.
        temperature: 0,
        max_tokens: 2048,
      });

      const eleccion = respuesta.choices[0]?.message;
      if (!eleccion) {
        return error('El asistente no devolvió una respuesta.', 502);
      }

      const llamadas = eleccion.tool_calls ?? [];

      if (llamadas.length === 0) {
        const texto = (eleccion.content ?? '').trim();
        return Response.json({
          texto: texto || 'No pude armar una respuesta. Probá preguntarlo de otra forma.',
          consultas,
          modelo,
        });
      }

      mensajes.push(eleccion);

      // Las llamadas de una misma respuesta se resuelven juntas; cada resultado
      // vuelve como un mensaje 'tool' con el id de su llamada.
      const resultados = await Promise.all(
        llamadas.map(async (llamada) => {
          if (llamada.type !== 'function') {
            return { tool_call_id: llamada.id, contenido: 'Tipo de llamada no soportado.' };
          }

          const nombre = llamada.function.name;
          const entrada = argumentosDe(llamada.function.arguments);

          try {
            if (nombre === 'consultar_indicadores') {
              const { funcion, parametros } = parametrosDeIndicador(entrada);
              const { data, error: fallo } = await supabase.rpc(funcion, parametros);
              if (fallo) throw new Error(fallo.message);

              consultas.push({
                herramienta: String(entrada.indicador ?? 'resumen'),
                detalle: describir(entrada),
              });
              return { tool_call_id: llamada.id, contenido: JSON.stringify(data ?? {}) };
            }

            if (nombre === 'listar_clases') {
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
              return { tool_call_id: llamada.id, contenido: JSON.stringify(data ?? []) };
            }

            throw new Error(`Herramienta desconocida: ${nombre}`);
          } catch (e) {
            // El error vuelve al modelo para que reformule, no rompe la respuesta.
            return {
              tool_call_id: llamada.id,
              contenido: `No se pudo consultar: ${e instanceof Error ? e.message : 'error'}`,
            };
          }
        }),
      );

      for (const r of resultados) {
        mensajes.push({ role: 'tool', tool_call_id: r.tool_call_id, content: r.contenido });
      }
    }

    return Response.json({
      texto: 'La consulta se hizo muy larga. Probá acotarla, por ejemplo a un período o a un lugar.',
      consultas,
      modelo,
    });
  } catch (e) {
    if (e instanceof OpenAI.AuthenticationError) {
      return error('La clave de OpenRouter no es válida. Revisá OPENROUTER_API_KEY.', 503);
    }
    if (e instanceof OpenAI.RateLimitError) {
      return error('El asistente está saturado o sin crédito. Probá en unos minutos.', 429);
    }
    if (e instanceof OpenAI.NotFoundError) {
      return error(
        `OpenRouter no reconoce el modelo «${modelo}». Revisá OPENROUTER_MODEL.`,
        503,
      );
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
