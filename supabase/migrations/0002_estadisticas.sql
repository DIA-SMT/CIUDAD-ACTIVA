-- ============================================================================
--  Ciudad Activa - REQ 7: indicadores del programa (PostgreSQL / Supabase)
--  Direccion de Deportes y Recreacion | Municipalidad de San Miguel de Tucuman
--
--  Siete funciones que el tablero consume por RPC. El calculo vive en la base y
--  no en la aplicacion por dos motivos: vale igual para cualquier camino de
--  acceso, y al ser "security invoker" las politicas RLS de 0001 siguen
--  aplicando con la identidad de quien consulta.
--
--  DEFINICIONES, UNICAS PARA TODO EL SISTEMA. Ningun calculo de este archivo las
--  reinterpreta y un indicador nuevo tiene que seguir estas mismas reglas:
--
--    * "clase registrada" = cualquier fila del subconjunto filtrado, con las
--      suspendidas incluidas. Es el denominador del porcentaje de suspensiones.
--    * "clase realizada"  = es_suspension = false. Es lo que se cuenta como
--      clase efectivamente dictada en todos los indicadores de actividad.
--    * Los alumnos (total, nuevos, varones, mujeres), los promedios y la
--      distribucion por sexo se calculan SOLO sobre clases realizadas: una clase
--      suspendida no tuvo asistentes y no debe diluir ningun promedio.
--    * profesores_activos y lugares_activos cuentan a los que tienen al menos
--      una clase realizada dentro del subconjunto filtrado.
--    * Los porcentajes y los promedios se calculan aca, en SQL, redondeados a un
--      decimal: nullif() saca la division por cero y coalesce() devuelve 0
--      cuando no hay denominador. Ningun campo numerico sale null ni NaN.
--    * El subconjunto se arma SIEMPRE con fn_registros_filtrados(): la condicion
--      del REQ 8 esta escrita una sola vez, de modo que los siete indicadores y
--      el listado miran exactamente las mismas filas. Si manana cambia un
--      filtro, cambia para todos a la vez.
--
--  Las funciones que devuelven listas devuelven json (un arreglo), no setof: el
--  Route Handler pasa el resultado tal cual a la respuesta. Las claves, su orden
--  y sus tipos son los de lib/tipos.ts, y estan siempre todas aunque valgan 0.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Normalizacion del texto de busqueda (filtro q del REQ 8).
--
-- unaccent puede no estar instalado en el proyecto, asi que el plegado de
-- acentos se hace con translate() sobre las vocales del castellano, que es todo
-- lo que hace falta aca: "Niño" encuentra "nino" y "Plaza Belgrano" encuentra
-- "belgrano". Se aplica a los dos lados de la comparacion.
-- ---------------------------------------------------------------------------
create or replace function public.fn_texto_buscable(p_texto text)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select lower(translate(
    coalesce(p_texto, ''),
    'ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòùÂÊÎÔÛâêîôûÄËÏÖäëïöÇç',
    'AEIOUUNaeiouunAEIOUaeiouAEIOUaeiouAEIOaeioCc'
  ));
$$;

comment on function public.fn_texto_buscable(text) is
  'Minusculas y sin acentos, para que el filtro q no dependa de como se tipeo.';


-- ---------------------------------------------------------------------------
-- Clave y etiqueta del periodo, segun el agrupamiento pedido.
--
-- La etiqueta sale ya armada para el grafico. Coincide exactamente con lo que
-- devuelve periodoLegible() de lib/fechas.ts para la misma clave, de modo que
-- el servidor y el navegador rotulan igual:
--    dia    '2026-09-08' -> '8/09'
--    semana '2026-W37'   -> 'sem. 37 de 2026'
--    mes    '2026-09'    -> 'septiembre 2026'
--
-- p_agrupar solo elige una rama de este case: nunca se interpola en el SQL, y
-- cualquier valor que no sea 'dia' o 'semana' cae en 'mes'.
-- ---------------------------------------------------------------------------
create or replace function public.fn_periodo(p_fecha date, p_agrupar text default 'mes')
returns table (clave text, etiqueta text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    case a.agrupar
      when 'dia'    then to_char(p_fecha, 'YYYY-MM-DD')
      when 'semana' then to_char(date_trunc('week', p_fecha), 'IYYY-"W"IW')
      else               to_char(p_fecha, 'YYYY-MM')
    end,
    case a.agrupar
      when 'dia'    then to_char(p_fecha, 'FMDD/MM')
      when 'semana' then 'sem. ' || to_char(date_trunc('week', p_fecha), 'FMIW')
                         || ' de ' || to_char(date_trunc('week', p_fecha), 'IYYY')
      else (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
           ])[extract(month from p_fecha)::int] || ' ' || to_char(p_fecha, 'YYYY')
    end
  from (
    select case lower(btrim(coalesce(p_agrupar, '')))
             when 'dia'    then 'dia'
             when 'semana' then 'semana'
             else               'mes'
           end
  ) as a (agrupar);
$$;

comment on function public.fn_periodo(date, text) is
  'Clave y etiqueta legible del periodo (dia, semana o mes) de una fecha.';


-- ---------------------------------------------------------------------------
-- EL filtro del REQ 8. Una sola definicion para los siete indicadores.
--
-- null en un parametro significa "sin filtrar". La condicion es la misma que
-- aplica aplicarFiltros() de lib/consultas.ts sobre v_registros: si las dos se
-- separaran, el tablero podria contar un conjunto de clases y la tabla del
-- listado mostrar otro, que es la peor falla posible en un sistema que se usa
-- para informar.
--
-- Unica diferencia, y a proposito: el listado le saca las comas y los parentesis
-- a q porque rompen la sintaxis de .or() de PostgREST. Aca el texto viaja como
-- parametro, nunca concatenado al SQL, asi que se busca tal como se escribio.
-- ---------------------------------------------------------------------------
create or replace function public.fn_registros_filtrados(
  p_desde    date   default null,
  p_hasta    date   default null,
  p_profesor uuid   default null,
  p_lugar    bigint default null,
  p_estado   text   default null,
  p_q        text   default null
)
returns setof public.v_registros
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select v.*
  from public.v_registros v
  where (p_desde is null or v.fecha >= p_desde)
    and (p_hasta is null or v.fecha <= p_hasta)
    and (p_profesor is null or v.profesor_id = p_profesor)
    and (p_lugar is null or v.lugar_id = p_lugar)
    and (p_estado is null or v.estado_codigo = p_estado)
    and (
      nullif(btrim(coalesce(p_q, '')), '') is null
      or public.fn_texto_buscable(v.observaciones)
           like '%' || public.fn_texto_buscable(p_q) || '%'
      or public.fn_texto_buscable(v.profesor_nombre)
           like '%' || public.fn_texto_buscable(p_q) || '%'
      or public.fn_texto_buscable(v.lugar_nombre)
           like '%' || public.fn_texto_buscable(p_q) || '%'
    );
$$;

comment on function public.fn_registros_filtrados(date, date, uuid, bigint, text, text) is
  'REQ 8: subconjunto filtrado de v_registros. Base unica de los indicadores.';


-- ============================================================================
--  REQ 7 - Indicadores
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Resumen general del periodo filtrado -> Resumen de lib/tipos.ts
--
-- primera_fecha y ultima_fecha se miden sobre las clases registradas: son el
-- alcance temporal de lo que se esta mirando, no de lo que se dicto.
-- Los dos porcentajes de sexo se calculan sobre varones + mujeres para que
-- siempre cierren en 100, aun si algun dato historico no respetara el CHECK.
-- ---------------------------------------------------------------------------
create or replace function public.estadisticas_resumen(
  p_desde    date   default null,
  p_hasta    date   default null,
  p_profesor uuid   default null,
  p_lugar    bigint default null,
  p_estado   text   default null,
  p_q        text   default null
)
returns json
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with base as (
    select *
    from public.fn_registros_filtrados(p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q)
  ),
  t as (
    select
      count(*)::bigint                                                           as registradas,
      count(*) filter (where not es_suspension)::bigint                          as realizadas,
      count(*) filter (where es_suspension)::bigint                              as suspendidas,
      coalesce(sum(alumnos_total)  filter (where not es_suspension), 0)::bigint  as alumnos,
      coalesce(sum(alumnos_nuevos) filter (where not es_suspension), 0)::bigint  as nuevos,
      coalesce(sum(varones)        filter (where not es_suspension), 0)::bigint  as varones,
      coalesce(sum(mujeres)        filter (where not es_suspension), 0)::bigint  as mujeres,
      count(distinct profesor_id) filter (where not es_suspension)::bigint       as profesores,
      count(distinct lugar_id)    filter (where not es_suspension)::bigint       as lugares,
      min(fecha)                                                                 as primera,
      max(fecha)                                                                 as ultima
    from base
  )
  select json_build_object(
    'clases_registradas',     t.registradas,
    'clases_realizadas',      t.realizadas,
    'clases_suspendidas',     t.suspendidas,
    'porcentaje_suspendidas', coalesce(round(t.suspendidas * 100.0
                                             / nullif(t.registradas, 0), 1), 0),
    'alumnos_total',          t.alumnos,
    'alumnos_nuevos',         t.nuevos,
    'varones',                t.varones,
    'mujeres',                t.mujeres,
    'porcentaje_varones',     coalesce(round(t.varones * 100.0
                                             / nullif(t.varones + t.mujeres, 0), 1), 0),
    'porcentaje_mujeres',     coalesce(round(t.mujeres * 100.0
                                             / nullif(t.varones + t.mujeres, 0), 1), 0),
    'promedio_por_clase',     coalesce(round(t.alumnos * 1.0
                                             / nullif(t.realizadas, 0), 1), 0),
    'profesores_activos',     t.profesores,
    'lugares_activos',        t.lugares,
    'primera_fecha',          t.primera,
    'ultima_fecha',           t.ultima
  )
  from t;
$$;

comment on function public.estadisticas_resumen(date, date, uuid, bigint, text, text) is
  'REQ 7: clases, alumnos, sexo, promedio y suspensiones del periodo filtrado.';


-- ---------------------------------------------------------------------------
-- Clases y alumnos por profesor -> FilaProfesor[] de lib/tipos.ts
-- Ordenado por alumnos y clases: arriba queda quien mas moviliza.
-- ---------------------------------------------------------------------------
create or replace function public.estadisticas_por_profesor(
  p_desde    date   default null,
  p_hasta    date   default null,
  p_profesor uuid   default null,
  p_lugar    bigint default null,
  p_estado   text   default null,
  p_q        text   default null
)
returns json
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    json_agg(f order by f.alumnos desc, f.clases desc, f.profesor asc),
    '[]'::json
  )
  from (
    select
      g.profesor_id,
      g.profesor,
      g.cargo,
      g.clases,
      g.alumnos,
      g.alumnos_nuevos,
      coalesce(round(g.alumnos * 1.0 / nullif(g.clases, 0), 1), 0) as promedio,
      g.suspendidas
    from (
      select
        b.profesor_id                                                                as profesor_id,
        b.profesor_nombre                                                            as profesor,
        b.profesor_cargo                                                             as cargo,
        count(*) filter (where not b.es_suspension)::bigint                          as clases,
        coalesce(sum(b.alumnos_total)  filter (where not b.es_suspension), 0)::bigint as alumnos,
        coalesce(sum(b.alumnos_nuevos) filter (where not b.es_suspension), 0)::bigint as alumnos_nuevos,
        count(*) filter (where b.es_suspension)::bigint                              as suspendidas
      from public.fn_registros_filtrados(p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q) b
      group by b.profesor_id, b.profesor_nombre, b.profesor_cargo
    ) g
  ) f;
$$;

comment on function public.estadisticas_por_profesor(date, date, uuid, bigint, text, text) is
  'REQ 7: clases por profesor y alumnos por profesor.';


-- ---------------------------------------------------------------------------
-- Clases y alumnos por lugar -> FilaLugar[] de lib/tipos.ts
--
-- ultima_clase es la fecha de la ultima clase realizada en el espacio: es el
-- indicador de "nivel de actividad de cada espacio" que pide el REQ 7. Un lugar
-- con suspensiones nada mas la tiene en null, que es justamente el dato.
-- ---------------------------------------------------------------------------
create or replace function public.estadisticas_por_lugar(
  p_desde    date   default null,
  p_hasta    date   default null,
  p_profesor uuid   default null,
  p_lugar    bigint default null,
  p_estado   text   default null,
  p_q        text   default null
)
returns json
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    json_agg(f order by f.alumnos desc, f.clases desc, f.lugar asc),
    '[]'::json
  )
  from (
    select
      g.lugar_id,
      g.lugar,
      g.clases,
      g.alumnos,
      g.alumnos_nuevos,
      coalesce(round(g.alumnos * 1.0 / nullif(g.clases, 0), 1), 0) as promedio,
      g.suspendidas,
      g.ultima_clase
    from (
      select
        b.lugar_id                                                                   as lugar_id,
        b.lugar_nombre                                                               as lugar,
        count(*) filter (where not b.es_suspension)::bigint                          as clases,
        coalesce(sum(b.alumnos_total)  filter (where not b.es_suspension), 0)::bigint as alumnos,
        coalesce(sum(b.alumnos_nuevos) filter (where not b.es_suspension), 0)::bigint as alumnos_nuevos,
        count(*) filter (where b.es_suspension)::bigint                              as suspendidas,
        max(b.fecha) filter (where not b.es_suspension)                              as ultima_clase
      from public.fn_registros_filtrados(p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q) b
      group by b.lugar_id, b.lugar_nombre
    ) g
  ) f;
$$;

comment on function public.estadisticas_por_lugar(date, date, uuid, bigint, text, text) is
  'REQ 7: alumnos por lugar y nivel de actividad de cada espacio (ultima_clase).';


-- ---------------------------------------------------------------------------
-- Evolucion de la matricula por periodo -> PuntoEvolucion[] de lib/tipos.ts
--
-- Orden cronologico ascendente. Las tres claves de periodo empiezan por el anio
-- y estan rellenadas con ceros, asi que ordenar por texto es ordenar por fecha.
-- Un periodo sin registros no aparece: no se inventan huecos, el grafico dibuja
-- lo que llega. Un periodo con clases suspendidas nada mas aparece con clases
-- en 0, que es informacion util.
-- ---------------------------------------------------------------------------
create or replace function public.estadisticas_evolucion(
  p_desde    date   default null,
  p_hasta    date   default null,
  p_profesor uuid   default null,
  p_lugar    bigint default null,
  p_estado   text   default null,
  p_q        text   default null,
  p_agrupar  text   default 'mes'
)
returns json
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(json_agg(f order by f.periodo asc), '[]'::json)
  from (
    select
      g.periodo,
      g.etiqueta,
      g.clases,
      g.alumnos,
      g.alumnos_nuevos,
      coalesce(round(g.alumnos * 1.0 / nullif(g.clases, 0), 1), 0) as promedio
    from (
      select
        p.clave                                                                      as periodo,
        p.etiqueta                                                                   as etiqueta,
        count(*) filter (where not b.es_suspension)::bigint                          as clases,
        coalesce(sum(b.alumnos_total)  filter (where not b.es_suspension), 0)::bigint as alumnos,
        coalesce(sum(b.alumnos_nuevos) filter (where not b.es_suspension), 0)::bigint as alumnos_nuevos
      from public.fn_registros_filtrados(p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q) b
      cross join lateral public.fn_periodo(b.fecha, p_agrupar) p
      group by p.clave, p.etiqueta
    ) g
  ) f;
$$;

comment on function public.estadisticas_evolucion(date, date, uuid, bigint, text, text, text) is
  'REQ 7: evolucion de la matricula y de la participacion por periodo.';


-- ---------------------------------------------------------------------------
-- Distribucion por sexo -> DistribucionSexo de lib/tipos.ts
--
-- p_agrupar es opcional y vale 'mes' si no viene: el contrato solo se lo exige a
-- evolucion y a tablero, pero por_periodo necesita un corte temporal y asi el
-- tablero puede pedir el mismo que el resto del panel.
-- ---------------------------------------------------------------------------
create or replace function public.estadisticas_sexo(
  p_desde    date   default null,
  p_hasta    date   default null,
  p_profesor uuid   default null,
  p_lugar    bigint default null,
  p_estado   text   default null,
  p_q        text   default null,
  p_agrupar  text   default 'mes'
)
returns json
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with base as (
    select *
    from public.fn_registros_filtrados(p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q)
  ),
  totales as (
    select
      coalesce(sum(varones) filter (where not es_suspension), 0)::bigint as varones,
      coalesce(sum(mujeres) filter (where not es_suspension), 0)::bigint as mujeres
    from base
  ),
  serie as (
    select coalesce(json_agg(f order by f.periodo asc), '[]'::json) as datos
    from (
      select
        p.clave                                                                 as periodo,
        p.etiqueta                                                              as etiqueta,
        coalesce(sum(b.varones) filter (where not b.es_suspension), 0)::bigint  as varones,
        coalesce(sum(b.mujeres) filter (where not b.es_suspension), 0)::bigint  as mujeres
      from base b
      cross join lateral public.fn_periodo(b.fecha, p_agrupar) p
      group by p.clave, p.etiqueta
    ) f
  )
  select json_build_object(
    'varones',            t.varones,
    'mujeres',            t.mujeres,
    'porcentaje_varones', coalesce(round(t.varones * 100.0
                                         / nullif(t.varones + t.mujeres, 0), 1), 0),
    'porcentaje_mujeres', coalesce(round(t.mujeres * 100.0
                                         / nullif(t.varones + t.mujeres, 0), 1), 0),
    'por_periodo',        s.datos
  )
  from totales t cross join serie s;
$$;

comment on function public.estadisticas_sexo(date, date, uuid, bigint, text, text, text) is
  'REQ 7: distribucion por sexo, total y periodo a periodo.';


-- ---------------------------------------------------------------------------
-- Suspensiones -> Suspensiones de lib/tipos.ts
--
-- El porcentaje general se mide sobre las clases registradas ("cuanto de lo
-- programado no se hizo"); el de cada motivo, sobre el total de suspensiones
-- ("por que no se hizo"). El detalle trae las observaciones, que es donde el
-- profesor escribe el motivo concreto, acotado a las 200 mas recientes: alcanza
-- para leerlas sin mandar el historico entero al navegador.
-- ---------------------------------------------------------------------------
create or replace function public.estadisticas_suspensiones(
  p_desde    date   default null,
  p_hasta    date   default null,
  p_profesor uuid   default null,
  p_lugar    bigint default null,
  p_estado   text   default null,
  p_q        text   default null
)
returns json
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with base as (
    select *
    from public.fn_registros_filtrados(p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q)
  ),
  totales as (
    select
      count(*)::bigint                             as registradas,
      count(*) filter (where es_suspension)::bigint as suspendidas
    from base
  ),
  susp as (
    select * from base where es_suspension
  ),
  motivos as (
    select coalesce(json_agg(m order by m.cantidad desc, m.nombre asc), '[]'::json) as datos
    from (
      select
        s.estado_codigo  as codigo,
        s.estado_nombre  as nombre,
        count(*)::bigint as cantidad,
        coalesce(round(count(*) * 100.0
                       / nullif((select t.suspendidas from totales t), 0), 1), 0) as porcentaje
      from susp s
      group by s.estado_codigo, s.estado_nombre
    ) m
  ),
  espacios as (
    select coalesce(json_agg(l order by l.cantidad desc, l.lugar asc), '[]'::json) as datos
    from (
      select s.lugar_nombre as lugar, count(*)::bigint as cantidad
      from susp s
      group by s.lugar_id, s.lugar_nombre
    ) l
  ),
  detalle as (
    select coalesce(json_agg(d order by d.fecha desc, d.id desc), '[]'::json) as datos
    from (
      select
        s.id,
        s.fecha,
        s.lugar_nombre    as lugar,
        s.profesor_nombre as profesor,
        s.estado_nombre,
        s.observaciones
      from susp s
      order by s.fecha desc, s.id desc
      limit 200
    ) d
  )
  select json_build_object(
    'total',      t.suspendidas,
    'porcentaje', coalesce(round(t.suspendidas * 100.0 / nullif(t.registradas, 0), 1), 0),
    'por_motivo', mo.datos,
    'por_lugar',  es.datos,
    'detalle',    de.datos
  )
  from totales t
  cross join motivos mo
  cross join espacios es
  cross join detalle de;
$$;

comment on function public.estadisticas_suspensiones(date, date, uuid, bigint, text, text) is
  'REQ 7: cantidad y porcentaje de clases suspendidas, motivos y detalle.';


-- ---------------------------------------------------------------------------
-- Tablero completo -> Tablero de lib/tipos.ts
--
-- Una sola llamada para todo el panel. Compone las otras seis llamandolas: el
-- SQL de cada indicador existe una sola vez y el tablero no puede quedar
-- diciendo algo distinto que la vista suelta del mismo indicador.
-- ---------------------------------------------------------------------------
create or replace function public.estadisticas_tablero(
  p_desde    date   default null,
  p_hasta    date   default null,
  p_profesor uuid   default null,
  p_lugar    bigint default null,
  p_estado   text   default null,
  p_q        text   default null,
  p_agrupar  text   default 'mes'
)
returns json
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select json_build_object(
    'resumen',      public.estadisticas_resumen(
                      p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q),
    'por_profesor', public.estadisticas_por_profesor(
                      p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q),
    'por_lugar',    public.estadisticas_por_lugar(
                      p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q),
    'evolucion',    public.estadisticas_evolucion(
                      p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q, p_agrupar),
    'sexo',         public.estadisticas_sexo(
                      p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q, p_agrupar),
    'suspensiones', public.estadisticas_suspensiones(
                      p_desde, p_hasta, p_profesor, p_lugar, p_estado, p_q)
  );
$$;

comment on function public.estadisticas_tablero(date, date, uuid, bigint, text, text, text) is
  'REQ 7: los seis indicadores del panel en una sola llamada.';


-- ============================================================================
--  Permisos. Son security invoker, asi que RLS sigue decidiendo que filas ve
--  cada uno: el grant solo habilita la llamada.
-- ============================================================================
grant execute on function public.fn_texto_buscable(text) to authenticated;
grant execute on function public.fn_periodo(date, text) to authenticated;
grant execute on function public.fn_registros_filtrados(date, date, uuid, bigint, text, text) to authenticated;

grant execute on function public.estadisticas_resumen(date, date, uuid, bigint, text, text) to authenticated;
grant execute on function public.estadisticas_por_profesor(date, date, uuid, bigint, text, text) to authenticated;
grant execute on function public.estadisticas_por_lugar(date, date, uuid, bigint, text, text) to authenticated;
grant execute on function public.estadisticas_evolucion(date, date, uuid, bigint, text, text, text) to authenticated;
grant execute on function public.estadisticas_sexo(date, date, uuid, bigint, text, text, text) to authenticated;
grant execute on function public.estadisticas_suspensiones(date, date, uuid, bigint, text, text) to authenticated;
grant execute on function public.estadisticas_tablero(date, date, uuid, bigint, text, text, text) to authenticated;
