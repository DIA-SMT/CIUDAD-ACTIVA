// REQ 5 y REQ 8: exportacion del historico a CSV, con los mismos filtros que el
// listado y sin paginar.
//
// El archivo se abre en Excel, que es donde la Direccion arma los informes: por
// eso lleva BOM (sin el, Excel en español lee el UTF-8 como ANSI y rompe todos
// los acentos), separador ';' y salto de linea CRLF.

import {
  aplicarFiltros,
  error,
  errorDePostgres,
  filtrosDeQuery,
  ordenDeQuery,
} from '@/lib/consultas';
import { fmt, hoyISO } from '@/lib/fechas';
import { clienteServidor, sesionActual } from '@/lib/supabase/servidor';
import type { Registro } from '@/lib/tipos';

const CABECERAS = [
  'N° de registro', 'Fecha', 'Profesor', 'Cargo', 'Lugar', 'Estado de la clase',
  'Suspendida', 'Total de alumnos', 'Alumnos nuevos', 'Varones', 'Mujeres',
  'Observaciones', 'Correo del responsable', 'Cargado por',
  'Fecha de carga', 'Última modificación',
];

// PostgREST tiene un tope de filas por respuesta, asi que la exportacion se
// arma en lotes hasta agotar el resultado. El tope general evita que un filtro
// vacio sobre anios de historico deje el pedido colgado.
const LOTE = 1000;
const TOPE = 50_000;

/**
 * Una celda del CSV. Se entrecomilla en cuanto aparece el separador, una
 * comilla o un salto de linea, y las comillas internas se duplican: sin esto un
 * ';' escrito dentro de las observaciones corre todas las columnas siguientes.
 */
function celda(valor: string | number | null | undefined): string {
  const texto = String(valor ?? '').replace(/\r\n?/g, '\n');
  return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

const fila = (celdas: (string | number | null | undefined)[]): string =>
  celdas.map(celda).join(';');

export async function GET(pedido: Request) {
  const sesion = await sesionActual();
  if (!sesion) return error('Necesitás iniciar sesión.', 401);

  const sp = new URL(pedido.url).searchParams;
  const filtros = filtrosDeQuery(sp);
  // Cronologico por defecto: es el orden en el que se lee una planilla.
  const orden = ordenDeQuery(sp, 'fecha_asc');

  const supabase = await clienteServidor();

  const registros: Registro[] = [];

  for (let inicio = 0; inicio < TOPE; inicio += LOTE) {
    const { data, error: fallo } = await aplicarFiltros(
      supabase.from('v_revision').select('*'),
      filtros,
    )
      .order(orden.columna, { ascending: orden.asc })
      .order('id', { ascending: orden.asc })
      .range(inicio, inicio + LOTE - 1)
      .returns<Registro[]>();

    if (fallo) {
      // PostgREST contesta 416 cuando el lote arranca despues de la ultima
      // fila, que es lo que pasa cuando el total es multiplo exacto de LOTE.
      if (fallo.code === 'PGRST103') break;
      return errorDePostgres(fallo);
    }
    if (!data || data.length === 0) break;

    registros.push(...data);
    if (data.length < LOTE) break;
  }

  const lineas = [fila(CABECERAS)];

  for (const r of registros) {
    lineas.push(fila([
      r.id,
      fmt.fecha(r.fecha),
      r.profesor_nombre,
      r.profesor_cargo,
      r.lugar_nombre,
      r.estado_nombre,
      r.es_suspension ? 'Sí' : 'No',
      r.alumnos_total,
      r.alumnos_nuevos,
      r.varones,
      r.mujeres,
      r.observaciones,
      r.email_responsable,
      r.cargado_por_nombre ?? '',
      fmt.fechaHora(r.creado_en),
      fmt.fechaHora(r.actualizado_en),
    ]));
  }

  const csv = `﻿${lineas.join('\r\n')}\r\n`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ciudad-activa-${hoyISO()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
