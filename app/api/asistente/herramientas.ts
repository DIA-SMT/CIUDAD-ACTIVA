// Las herramientas que el asistente puede usar para responder.
//
// Decision de fondo: el modelo NO escribe SQL. Elige entre las funciones que ya
// calculan los indicadores del REQ 7 y el listado del REQ 8, con los mismos
// filtros que usa el panel. Tres motivos:
//
//   1. No puede inventar un numero: lo que responde sale de las mismas
//      funciones que alimentan el tablero, asi que nunca puede contradecirlo.
//   2. No puede leer ni escribir nada que el usuario no pueda: las consultas
//      van con su sesion, y RLS sigue aplicando.
//   3. Si mañana cambia la definicion de "clase realizada", cambia en un solo
//      lugar y el asistente la respeta sola.
//
// El formato es el de function calling de OpenAI, que es el que habla
// OpenRouter con cualquier modelo que se elija.

import type OpenAI from 'openai';
import { parametrosRPC } from '@/lib/consultas';
import type { Filtros } from '@/lib/tipos';

export const INDICADORES = {
  resumen: 'estadisticas_resumen',
  por_profesor: 'estadisticas_por_profesor',
  por_lugar: 'estadisticas_por_lugar',
  evolucion: 'estadisticas_evolucion',
  sexo: 'estadisticas_sexo',
  suspensiones: 'estadisticas_suspensiones',
} as const;

export type Indicador = keyof typeof INDICADORES;

/** Las que además aceptan un corte temporal. */
const CON_AGRUPACION = new Set<Indicador>(['evolucion', 'sexo']);

const FILTROS_SCHEMA = {
  desde: {
    type: 'string',
    description: 'Fecha de inicio, inclusive, en formato AAAA-MM-DD. Omitir para no acotar.',
  },
  hasta: {
    type: 'string',
    description: 'Fecha de fin, inclusive, en formato AAAA-MM-DD. Omitir para no acotar.',
  },
  profesor_id: {
    type: 'string',
    description: 'uuid del profesor, tomado del listado que está en las instrucciones.',
  },
  lugar_id: {
    type: 'integer',
    description: 'id del lugar, tomado del listado que está en las instrucciones.',
  },
  estado: {
    type: 'string',
    enum: ['normal', 'susp_clima', 'susp_feriado', 'susp_otro'],
    description: 'Filtra por estado de la clase.',
  },
  q: {
    type: 'string',
    description: 'Busca este texto en las observaciones, el profesor y el lugar.',
  },
} as const;

export const HERRAMIENTAS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'consultar_indicadores',
      description:
        'Devuelve los indicadores del programa ya calculados, con los filtros que se le pasen. ' +
        'Es la fuente para cualquier pregunta sobre cantidades, promedios, rankings o evolución. ' +
        'Usá "resumen" para totales generales; "por_profesor" y "por_lugar" para comparar o ' +
        'rankear; "evolucion" para series en el tiempo; "sexo" para la distribución por sexo; ' +
        '"suspensiones" para cuántas clases se suspendieron y por qué.',
      parameters: {
        type: 'object',
        properties: {
          indicador: {
            type: 'string',
            enum: Object.keys(INDICADORES),
            description: 'Qué indicador traer.',
          },
          agrupar: {
            type: 'string',
            enum: ['dia', 'semana', 'mes'],
            description:
              'Sólo para "evolucion" y "sexo": corte temporal de la serie. Por defecto, mes.',
          },
          ...FILTROS_SCHEMA,
        },
        required: ['indicador'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_clases',
      description:
        'Devuelve clases concretas, una por una, con su fecha, profesor, lugar, cantidades y ' +
        'observaciones. Sirve cuando la pregunta es por casos puntuales ("cuál fue la clase con ' +
        'más alumnos", "qué dijeron los profes cuando se suspendió", "mostrame las de tal plaza") ' +
        'y no por un total. Para totales usá consultar_indicadores, que es más exacto y barato.',
      parameters: {
        type: 'object',
        properties: {
          orden: {
            type: 'string',
            enum: ['fecha_desc', 'fecha_asc', 'alumnos_desc', 'creado_desc'],
            description: 'Cómo ordenar. Para "la clase con más alumnos", usá alumnos_desc.',
          },
          limite: {
            type: 'integer',
            description: 'Cuántas clases traer, de 1 a 50. Por defecto 10.',
          },
          ...FILTROS_SCHEMA,
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];

/** Toma sólo los filtros conocidos de lo que haya mandado el modelo. */
export function filtrosDeHerramienta(entrada: Record<string, unknown>): Filtros {
  const f: Filtros = {};
  if (typeof entrada.desde === 'string') f.desde = entrada.desde;
  if (typeof entrada.hasta === 'string') f.hasta = entrada.hasta;
  if (typeof entrada.profesor_id === 'string') f.profesor_id = entrada.profesor_id;
  if (typeof entrada.lugar_id === 'number') f.lugar_id = entrada.lugar_id;
  if (typeof entrada.estado === 'string') f.estado = entrada.estado;
  if (typeof entrada.q === 'string') f.q = entrada.q;
  return f;
}

export function parametrosDeIndicador(entrada: Record<string, unknown>) {
  const indicador = String(entrada.indicador) as Indicador;
  const parametros: Record<string, unknown> = parametrosRPC(filtrosDeHerramienta(entrada));

  if (CON_AGRUPACION.has(indicador)) {
    const a = String(entrada.agrupar ?? 'mes');
    parametros.p_agrupar = ['dia', 'semana', 'mes'].includes(a) ? a : 'mes';
  }

  return { funcion: INDICADORES[indicador] ?? INDICADORES.resumen, parametros };
}

/**
 * Los argumentos llegan como texto JSON. Un modelo chico a veces manda algo mal
 * formado: se devuelve un objeto vacio y la herramienta corre sin filtros, en
 * vez de romper toda la respuesta.
 */
export function argumentosDe(texto: string | undefined): Record<string, unknown> {
  if (!texto) return {};
  try {
    const v: unknown = JSON.parse(texto);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
