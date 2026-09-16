'use client';

import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { fmt } from '@/lib/fechas';
import { traerJSON, useRecurso } from '@/lib/usar-recurso';
import type {
  Agrupacion, FilaLugar, FilaProfesor, Tablero as DatosTablero,
} from '@/lib/tipos';
import { useFiltros } from './filtros';

const CONFIG = {
  alumnos: { label: 'Alumnos', color: 'var(--chart-1)' },
  clases: { label: 'Clases', color: 'var(--chart-2)' },
  alumnos_nuevos: { label: 'Alumnos nuevos', color: 'var(--chart-3)' },
  mujeres: { label: 'Mujeres', color: 'var(--chart-1)' },
  varones: { label: 'Varones', color: 'var(--chart-2)' },
  cantidad: { label: 'Cantidad', color: 'var(--chart-1)' },
} satisfies ChartConfig;

function Indicador({
  etiqueta, valor, detalle, acento,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  acento?: 'naranja' | 'rojo';
}) {
  const color =
    acento === 'naranja' ? 'text-naranja-600' : acento === 'rojo' ? 'text-rojo-600' : '';
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <p className="text-muted-foreground text-xs">{etiqueta}</p>
        <p className={`cifra mt-1 text-2xl font-semibold ${color}`}>{valor}</p>
        {detalle && <p className="text-muted-foreground mt-0.5 text-xs">{detalle}</p>}
      </CardContent>
    </Card>
  );
}

type Orden = { columna: string; asc: boolean };

/**
 * Ordenamiento de una tabla del tablero. Generico en T para no perder el tipo
 * de las filas: la columna se lee con un acceso por indice puntual, no
 * obligando a que todo el tipo tenga una firma de indice.
 */
function useOrden<T>(inicial: Extract<keyof T, string>) {
  const [orden, setOrden] = useState<Orden>({ columna: inicial, asc: false });

  const alternar = (columna: string) =>
    setOrden((o) => ({ columna, asc: o.columna === columna ? !o.asc : false }));

  const ordenar = (filas: T[]): T[] =>
    [...filas].sort((a, b) => {
      const x = (a as Record<string, unknown>)[orden.columna];
      const y = (b as Record<string, unknown>)[orden.columna];
      // Los nulos (un espacio sin clases realizadas) van siempre al final.
      if (x == null && y != null) return 1;
      if (y == null && x != null) return -1;
      const cmp =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x ?? '').localeCompare(String(y ?? ''), 'es');
      return orden.asc ? cmp : -cmp;
    });

  return { orden, alternar, ordenar };
}

function Ordenable({
  campo, orden, alternar, children, numerica,
}: {
  campo: string;
  orden: Orden;
  alternar: (c: string) => void;
  children: React.ReactNode;
  numerica?: boolean;
}) {
  const activa = orden.columna === campo;
  return (
    <TableHead
      className={numerica ? 'text-right' : undefined}
      aria-sort={activa ? (orden.asc ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => alternar(campo)}
        className="hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded focus-visible:ring-2 focus-visible:outline-none"
      >
        {children}
        <span aria-hidden className={activa ? '' : 'opacity-0'}>
          {orden.asc ? '↑' : '↓'}
        </span>
      </button>
    </TableHead>
  );
}

export function Tablero() {
  const { consulta } = useFiltros();
  const [agrupar, setAgrupar] = useState<Agrupacion>('mes');

  const ruta = `/api/estadisticas/tablero?${consulta}&agrupar=${agrupar}`;
  const { datos, error } = useRecurso(ruta, () => traerJSON<DatosTablero>(ruta));

  const lugares = useOrden<FilaLugar>('alumnos');
  const profesores = useOrden<FilaProfesor>('alumnos');

  if (error) {
    return <p className="text-rojo-600 py-10 text-center text-sm">
      No se pudieron cargar los indicadores.
    </p>;
  }

  if (!datos) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const { resumen: r, sexo, suspensiones: s } = datos;
  const sinDatos = r.clases_registradas === 0;

  if (sinDatos) {
    return (
      <div className="text-muted-foreground py-16 text-center text-balance">
        <p className="font-medium">No hay clases en el período elegido.</p>
        <p className="mt-1 text-sm">Probá ampliar las fechas o limpiar los filtros.</p>
      </div>
    );
  }

  const datosSexo = [
    { nombre: 'Mujeres', valor: sexo.mujeres, color: 'var(--chart-1)' },
    { nombre: 'Varones', valor: sexo.varones, color: 'var(--chart-2)' },
  ];

  return (
    <div className="space-y-6">
      {/* --- indicadores --- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador
          etiqueta="Clases realizadas"
          valor={fmt.numero(r.clases_realizadas)}
          detalle={`${fmt.numero(r.clases_registradas)} registradas`}
        />
        <Indicador
          etiqueta="Alumnos registrados"
          valor={fmt.numero(r.alumnos_total)}
          detalle="suma de asistentes por clase"
        />
        <Indicador
          etiqueta="Promedio por clase"
          valor={fmt.decimal(r.promedio_por_clase)}
          detalle="alumnos"
        />
        <Indicador
          etiqueta="Alumnos nuevos"
          valor={fmt.numero(r.alumnos_nuevos)}
          acento="naranja"
          detalle="incorporaciones del período"
        />
        <Indicador
          etiqueta="Clases suspendidas"
          valor={fmt.numero(r.clases_suspendidas)}
          acento={r.clases_suspendidas > 0 ? 'rojo' : undefined}
          detalle={`${fmt.porcentaje(r.porcentaje_suspendidas)} del total`}
        />
        <Indicador
          etiqueta="Mujeres"
          valor={fmt.porcentaje(r.porcentaje_mujeres)}
          detalle={`${fmt.numero(r.mujeres)} asistencias`}
        />
        <Indicador
          etiqueta="Profesores con clases"
          valor={fmt.numero(r.profesores_activos)}
        />
        <Indicador
          etiqueta="Espacios con clases"
          valor={fmt.numero(r.lugares_activos)}
          detalle={
            r.primera_fecha
              ? `${fmt.fecha(r.primera_fecha)} a ${fmt.fecha(r.ultima_fecha)}`
              : undefined
          }
        />
      </div>

      {/* --- evolucion --- */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-base">Evolución de la participación</CardTitle>
          <Select
            value={agrupar}
            onValueChange={(v) => setAgrupar((v as Agrupacion) ?? 'mes')}
          >
            <SelectTrigger className="no-imprimir w-36" aria-label="Agrupar por">
              <SelectValue>
                {(v: string | null) =>
                  ({ dia: 'Por día', semana: 'Por semana', mes: 'Por mes' })[
                    String(v)
                  ] ?? 'Por mes'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dia">Por día</SelectItem>
              <SelectItem value="semana">Por semana</SelectItem>
              <SelectItem value="mes">Por mes</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <ChartContainer config={CONFIG} className="h-72 w-full">
            <LineChart data={datos.evolucion} margin={{ left: 4, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                dataKey="alumnos"
                stroke="var(--color-alumnos)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
              <Line
                dataKey="alumnos_nuevos"
                stroke="var(--color-alumnos_nuevos)"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ChartContainer>

          {/* Los graficos acompañan; los numeros tienen que poder leerse igual. */}
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Clases</TableHead>
                  <TableHead className="text-right">Alumnos</TableHead>
                  <TableHead className="text-right">Nuevos</TableHead>
                  <TableHead className="text-right">Promedio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {datos.evolucion.map((p) => (
                  <TableRow key={p.periodo}>
                    <TableCell>{p.etiqueta}</TableCell>
                    <TableCell className="cifra text-right">{fmt.numero(p.clases)}</TableCell>
                    <TableCell className="cifra text-right">{fmt.numero(p.alumnos)}</TableCell>
                    <TableCell className="cifra text-naranja-600 text-right">
                      {fmt.numero(p.alumnos_nuevos)}
                    </TableCell>
                    <TableCell className="cifra text-right">{fmt.decimal(p.promedio)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* --- distribucion por sexo --- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribución por sexo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <ChartContainer config={CONFIG} className="h-48 w-full sm:w-48">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie data={datosSexo} dataKey="valor" nameKey="nombre" innerRadius={42}>
                    {datosSexo.map((d) => (
                      <Cell key={d.nombre} fill={d.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>

              {/* Con un reparto tan desparejo, la torta sola no alcanza. */}
              <dl className="w-full space-y-3">
                {datosSexo.map((d, i) => (
                  <div key={d.nombre} className="flex items-baseline gap-2">
                    <span
                      className="size-3 shrink-0 rounded-sm"
                      style={{ background: d.color }}
                      aria-hidden
                    />
                    <dt className="text-sm">{d.nombre}</dt>
                    <dd className="cifra ml-auto text-sm font-medium">
                      {fmt.numero(d.valor)}{' '}
                      <span className="text-muted-foreground">
                        ({fmt.porcentaje(
                          i === 0 ? sexo.porcentaje_mujeres : sexo.porcentaje_varones,
                        )})
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </CardContent>
        </Card>

        {/* --- suspensiones --- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clases suspendidas</CardTitle>
          </CardHeader>
          <CardContent>
            {s.total === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No hubo clases suspendidas en el período.
              </p>
            ) : (
              <>
                <p className="text-sm">
                  <span className="cifra text-rojo-600 text-2xl font-semibold">
                    {fmt.numero(s.total)}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    de {fmt.numero(r.clases_registradas)} clases ({fmt.porcentaje(s.porcentaje)})
                  </span>
                </p>
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="text-right">Clases</TableHead>
                      <TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.por_motivo.map((m) => (
                      <TableRow key={m.codigo}>
                        <TableCell>{m.nombre}</TableCell>
                        <TableCell className="cifra text-right">{fmt.numero(m.cantidad)}</TableCell>
                        <TableCell className="cifra text-right">
                          {fmt.porcentaje(m.porcentaje)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* --- nivel de actividad de cada espacio --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nivel de actividad de cada espacio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChartContainer config={CONFIG} className="h-64 w-full">
            <BarChart
              data={[...datos.por_lugar].sort((a, b) => b.alumnos - a.alumnos)}
              layout="vertical"
              margin={{ left: 8, right: 16 }}
            >
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="lugar"
                tickLine={false}
                axisLine={false}
                width={130}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="alumnos" fill="var(--color-alumnos)" radius={4} />
            </BarChart>
          </ChartContainer>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <Ordenable campo="lugar" {...lugares}>Lugar</Ordenable>
                  <Ordenable campo="clases" numerica {...lugares}>Clases</Ordenable>
                  <Ordenable campo="alumnos" numerica {...lugares}>Alumnos</Ordenable>
                  <Ordenable campo="promedio" numerica {...lugares}>Promedio</Ordenable>
                  <Ordenable campo="alumnos_nuevos" numerica {...lugares}>Nuevos</Ordenable>
                  <Ordenable campo="suspendidas" numerica {...lugares}>Susp.</Ordenable>
                  <Ordenable campo="ultima_clase" numerica {...lugares}>Última</Ordenable>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lugares.ordenar(datos.por_lugar).map((l) => (
                  <TableRow key={l.lugar_id}>
                    <TableCell className="font-medium">{l.lugar}</TableCell>
                    <TableCell className="cifra text-right">{fmt.numero(l.clases)}</TableCell>
                    <TableCell className="cifra text-right">{fmt.numero(l.alumnos)}</TableCell>
                    <TableCell className="cifra text-right">{fmt.decimal(l.promedio)}</TableCell>
                    <TableCell className="cifra text-naranja-600 text-right">
                      {fmt.numero(l.alumnos_nuevos)}
                    </TableCell>
                    <TableCell className="cifra text-right">
                      {l.suspendidas > 0 ? (
                        <span className="text-rojo-600">{fmt.numero(l.suspendidas)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="cifra text-right">
                      {l.ultima_clase ? fmt.fecha(l.ultima_clase) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* --- por profesor --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actividad por profesor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChartContainer config={CONFIG} className="h-64 w-full">
            <BarChart
              data={[...datos.por_profesor].sort((a, b) => b.clases - a.clases)}
              layout="vertical"
              margin={{ left: 8, right: 16 }}
            >
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="profesor"
                tickLine={false}
                axisLine={false}
                width={130}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="clases" fill="var(--color-clases)" radius={4} />
            </BarChart>
          </ChartContainer>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <Ordenable campo="profesor" {...profesores}>Profesor</Ordenable>
                  <Ordenable campo="clases" numerica {...profesores}>Clases</Ordenable>
                  <Ordenable campo="alumnos" numerica {...profesores}>Alumnos</Ordenable>
                  <Ordenable campo="promedio" numerica {...profesores}>Promedio</Ordenable>
                  <Ordenable campo="alumnos_nuevos" numerica {...profesores}>Nuevos</Ordenable>
                  <Ordenable campo="suspendidas" numerica {...profesores}>Susp.</Ordenable>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profesores.ordenar(datos.por_profesor).map((p) => (
                  <TableRow key={p.profesor_id}>
                    <TableCell className="font-medium">{p.profesor}</TableCell>
                    <TableCell className="cifra text-right">{fmt.numero(p.clases)}</TableCell>
                    <TableCell className="cifra text-right">{fmt.numero(p.alumnos)}</TableCell>
                    <TableCell className="cifra text-right">{fmt.decimal(p.promedio)}</TableCell>
                    <TableCell className="cifra text-naranja-600 text-right">
                      {fmt.numero(p.alumnos_nuevos)}
                    </TableCell>
                    <TableCell className="cifra text-right">
                      {p.suspendidas > 0 ? (
                        <span className="text-rojo-600">{fmt.numero(p.suspendidas)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
