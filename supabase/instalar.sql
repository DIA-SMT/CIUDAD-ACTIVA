-- ============================================================================
--  Ciudad Activa — script de instalacion completo
--
--  COMO USARLO
--    1. Abri el proyecto en supabase.com
--    2. SQL Editor > New query
--    3. Pega TODO este archivo y dale Run
--
--  Es todo una sola transaccion: si algo falla, no queda nada a medias y se
--  puede corregir y volver a correr. Correrlo dos veces sobre una base ya
--  instalada da error en los CREATE TABLE, que es lo que se busca: avisa en
--  vez de pisar datos.
--
--  Generado a partir de supabase/migrations/. No editar a mano: editar las
--  migraciones y volver a generar.
-- ============================================================================

begin;

create table if not exists public.migraciones (
  nombre      text primary key,
  aplicada_en timestamptz not null default now()
);


-- ===========================================================================
-- 0001_esquema.sql
-- ===========================================================================

-- ============================================================================
--  Ciudad Activa - esquema inicial (PostgreSQL / Supabase)
--  Direccion de Deportes y Recreacion | Municipalidad de San Miguel de Tucuman
--
--  Las credenciales las maneja Supabase Auth en auth.users. Esta migracion
--  define el dominio del programa y, sobre todo, pone las reglas de negocio
--  dentro de la base: las validaciones como CHECK, los permisos como politicas
--  RLS y la auditoria como trigger. Asi valen para cualquier camino de acceso,
--  no solo para el que pasa por la aplicacion.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Perfiles: el listado de profesores autorizados del REQ 2.
-- Una fila por cada usuario de auth.users.
-- ---------------------------------------------------------------------------
create table public.perfiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  nombre         text not null check (length(btrim(nombre)) between 2 and 120),
  cargo          text not null default 'Profesor',
  email          text not null unique,
  rol            text not null default 'profesor' check (rol in ('profesor', 'admin')),
  -- aparece en el desplegable de profesores del formulario de carga
  dicta_clases   boolean not null default true,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index ix_perfiles_activos on public.perfiles (activo, dicta_clases);

comment on table public.perfiles is
  'REQ 2: listado de profesores autorizados. Los registros lo referencian por id.';

-- ---------------------------------------------------------------------------
-- REQ 3: espacios de actividad previamente definidos.
-- ---------------------------------------------------------------------------
create table public.lugares (
  id             bigint generated always as identity primary key,
  nombre         text not null unique check (length(btrim(nombre)) between 2 and 120),
  descripcion    text not null default '',
  activo         boolean not null default true,
  orden          integer not null default 0,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index ix_lugares_activos on public.lugares (activo, orden);

-- ---------------------------------------------------------------------------
-- Estado de la clase. es_suspension habilita los indicadores del REQ 7
-- (cantidad y porcentaje de suspendidas, motivos de suspension).
-- ---------------------------------------------------------------------------
create table public.estados_clase (
  codigo        text primary key,
  nombre        text not null unique,
  es_suspension boolean not null default false,
  activo        boolean not null default true,
  orden         integer not null default 0
);

-- ---------------------------------------------------------------------------
-- REQ 1: registro individual de cada actividad/clase.
-- REQ 4: las validaciones numericas viven aca como CHECK, ademas de estar en
--        el formulario y en la API, para que ningun camino pueda saltearlas.
-- ---------------------------------------------------------------------------
create table public.registros (
  id                bigint generated always as identity primary key,
  fecha             date not null,
  profesor_id       uuid   not null references public.perfiles (id)      on delete restrict,
  lugar_id          bigint not null references public.lugares (id)       on delete restrict,
  estado_codigo     text   not null references public.estados_clase (codigo) on delete restrict,
  alumnos_total     integer not null default 0,
  alumnos_nuevos    integer not null default 0,
  varones           integer not null default 0,
  mujeres           integer not null default 0,
  observaciones     text not null default '',
  email_responsable text not null,
  cargado_por       uuid references public.perfiles (id) on delete set null,
  origen            text not null default 'web' check (origen in ('web', 'importacion')),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint ck_no_negativos    check (alumnos_total >= 0 and alumnos_nuevos >= 0
                                   and varones >= 0 and mujeres >= 0),
  -- REQ 4: la comprobacion central.
  constraint ck_suma_sexos      check (varones + mujeres = alumnos_total),
  constraint ck_nuevos_en_total check (alumnos_nuevos <= alumnos_total),
  constraint ck_sin_futuro      check (fecha <= current_date),
  constraint ck_observaciones   check (length(observaciones) <= 1000)
);

-- REQ 5 y REQ 8: consulta por fecha, profesor, lugar y estado.
create index ix_registros_fecha    on public.registros (fecha desc);
create index ix_registros_profesor on public.registros (profesor_id, fecha desc);
create index ix_registros_lugar    on public.registros (lugar_id, fecha desc);
create index ix_registros_estado   on public.registros (estado_codigo, fecha desc);
-- No es unique a proposito: en los datos historicos hay dias con dos clases del
-- mismo profesor en el mismo lugar. El duplicado se avisa, no se bloquea.
create index ix_registros_dup      on public.registros (fecha, profesor_id, lugar_id);

-- ---------------------------------------------------------------------------
-- REQ 6: historial de modificaciones. Una fila por campo modificado.
-- Lo escribe el trigger de mas abajo, nunca la aplicacion: asi ninguna via de
-- acceso puede modificar un registro sin dejar rastro.
-- ---------------------------------------------------------------------------
create table public.registros_historial (
  id             bigint generated always as identity primary key,
  registro_id    bigint not null,
  accion         text not null check (accion in ('creacion', 'modificacion', 'eliminacion')),
  campo          text not null default '',
  valor_anterior text not null default '',
  valor_nuevo    text not null default '',
  usuario_id     uuid references public.perfiles (id) on delete set null,
  usuario_nombre text not null default '',
  fecha_hora     timestamptz not null default now()
);

create index ix_historial_registro on public.registros_historial (registro_id, id desc);
create index ix_historial_fecha    on public.registros_historial (fecha_hora desc);

-- ---------------------------------------------------------------------------
-- Parametros del sistema. Evita tener que redesplegar para cambiar una regla.
-- ---------------------------------------------------------------------------
create table public.parametros (
  clave text primary key,
  valor text not null,
  descripcion text not null default ''
);

insert into public.parametros (clave, valor, descripcion) values
  ('ventana_edicion_dias', '7',
   'Dias que tiene un profesor para corregir su propia carga. El admin no tiene limite.');

-- ============================================================================
--  Funciones de apoyo
-- ============================================================================

-- search_path fijo en todas: sin esto, una tabla creada en otro esquema por un
-- usuario malicioso podria secuestrar las consultas de una funcion SECURITY DEFINER.

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.perfiles
     where id = auth.uid() and rol = 'admin' and activo
  );
$$;

create or replace function public.es_usuario_activo()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.perfiles where id = auth.uid() and activo
  );
$$;

create or replace function public.ventana_edicion_dias()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select valor::integer from public.parametros
                    where clave = 'ventana_edicion_dias'), 7);
$$;

-- Mantiene actualizado_en sin depender de que la aplicacion se acuerde.
create or replace function public.fn_tocar_actualizado_en()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

create trigger tg_perfiles_actualizado before update on public.perfiles
  for each row execute function public.fn_tocar_actualizado_en();
create trigger tg_lugares_actualizado before update on public.lugares
  for each row execute function public.fn_tocar_actualizado_en();
create trigger tg_registros_actualizado before update on public.registros
  for each row execute function public.fn_tocar_actualizado_en();

-- ---------------------------------------------------------------------------
-- REQ 6: auditoria automatica.
-- ---------------------------------------------------------------------------
create or replace function public.fn_auditar_registros()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  quien_id     uuid := auth.uid();
  quien_nombre text;
  -- Los campos que se siguen, con su etiqueta para mostrar en pantalla.
  campos       text[] := array[
    'fecha', 'profesor_id', 'lugar_id', 'estado_codigo', 'alumnos_total',
    'alumnos_nuevos', 'varones', 'mujeres', 'observaciones', 'email_responsable'];
  campo        text;
  anterior     text;
  nuevo        text;
begin
  select nombre into quien_nombre from public.perfiles where id = quien_id;
  quien_nombre := coalesce(quien_nombre, 'Sistema');

  if tg_op = 'INSERT' then
    insert into public.registros_historial
      (registro_id, accion, valor_nuevo, usuario_id, usuario_nombre)
    values (new.id, 'creacion',
            format('%s - %s - %s alumnos', new.fecha,
                   (select nombre from public.lugares where id = new.lugar_id),
                   new.alumnos_total),
            quien_id, quien_nombre);
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.registros_historial
      (registro_id, accion, valor_anterior, usuario_id, usuario_nombre)
    values (old.id, 'eliminacion',
            format('%s - %s - %s alumnos', old.fecha,
                   (select nombre from public.lugares where id = old.lugar_id),
                   old.alumnos_total),
            quien_id, quien_nombre);
    return old;
  end if;

  -- UPDATE: una fila por campo que efectivamente cambio.
  foreach campo in array campos loop
    execute format('select ($1).%I::text, ($2).%I::text', campo, campo)
       into anterior, nuevo using old, new;

    if anterior is distinct from nuevo then
      -- Para las claves foraneas se guarda el nombre legible, no el id:
      -- el historial lo lee una persona, no un programa.
      if campo = 'lugar_id' then
        anterior := (select nombre from public.lugares where id = old.lugar_id);
        nuevo    := (select nombre from public.lugares where id = new.lugar_id);
      elsif campo = 'profesor_id' then
        anterior := (select nombre from public.perfiles where id = old.profesor_id);
        nuevo    := (select nombre from public.perfiles where id = new.profesor_id);
      elsif campo = 'estado_codigo' then
        anterior := (select nombre from public.estados_clase where codigo = old.estado_codigo);
        nuevo    := (select nombre from public.estados_clase where codigo = new.estado_codigo);
      end if;

      insert into public.registros_historial
        (registro_id, accion, campo, valor_anterior, valor_nuevo, usuario_id, usuario_nombre)
      values (new.id, 'modificacion', campo,
              coalesce(anterior, ''), coalesce(nuevo, ''), quien_id, quien_nombre);
    end if;
  end loop;

  return new;
end;
$$;

create trigger tg_auditar_registros
  after insert or update or delete on public.registros
  for each row execute function public.fn_auditar_registros();

-- ---------------------------------------------------------------------------
-- Alta automatica del perfil cuando Supabase Auth crea el usuario.
-- ---------------------------------------------------------------------------
create or replace function public.fn_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.perfiles (id, nombre, cargo, email, rol, dicta_clases, activo)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1)),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'cargo'), ''), 'Profesor'),
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'rol', ''), 'profesor'),
    coalesce((new.raw_user_meta_data ->> 'dicta_clases')::boolean, true),
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger tg_nuevo_usuario
  after insert on auth.users
  for each row execute function public.fn_nuevo_usuario();

-- ============================================================================
--  Vista de consulta: resuelve nombres y agrega los cortes de periodo.
-- ============================================================================
create view public.v_registros
with (security_invoker = true)
as
select
  r.id, r.fecha,
  r.profesor_id, p.nombre as profesor_nombre, p.cargo as profesor_cargo,
  r.lugar_id,    l.nombre as lugar_nombre,
  r.estado_codigo, e.nombre as estado_nombre, e.es_suspension,
  r.alumnos_total, r.alumnos_nuevos, r.varones, r.mujeres,
  r.observaciones, r.email_responsable, r.origen,
  r.cargado_por, c.nombre as cargado_por_nombre,
  r.creado_en, r.actualizado_en,
  extract(year  from r.fecha)::int        as anio,
  extract(month from r.fecha)::int        as mes,
  to_char(r.fecha, 'YYYY-MM')             as periodo,
  to_char(date_trunc('week', r.fecha), 'IYYY-"W"IW') as semana
from public.registros r
join public.perfiles      p on p.id = r.profesor_id
join public.lugares       l on l.id = r.lugar_id
join public.estados_clase e on e.codigo = r.estado_codigo
left join public.perfiles c on c.id = r.cargado_por;

-- ============================================================================
--  RLS: los permisos del REQ 6, aplicados por la base.
-- ============================================================================

alter table public.perfiles            enable row level security;
alter table public.lugares             enable row level security;
alter table public.estados_clase       enable row level security;
alter table public.registros           enable row level security;
alter table public.registros_historial enable row level security;
alter table public.parametros          enable row level security;

-- --- perfiles ---------------------------------------------------------------
-- Todos los usuarios activos ven el listado: lo necesitan para el desplegable.
create policy perfiles_lectura on public.perfiles
  for select to authenticated
  using (public.es_usuario_activo());

create policy perfiles_admin_alta on public.perfiles
  for insert to authenticated
  with check (public.es_admin());

create policy perfiles_admin_edicion on public.perfiles
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- Nadie se elimina: se desactiva, para no romper el historico del REQ 5.

-- --- catalogos --------------------------------------------------------------
create policy lugares_lectura on public.lugares
  for select to authenticated using (public.es_usuario_activo());
create policy lugares_admin on public.lugares
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

create policy estados_lectura on public.estados_clase
  for select to authenticated using (public.es_usuario_activo());
create policy estados_admin on public.estados_clase
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

create policy parametros_lectura on public.parametros
  for select to authenticated using (public.es_usuario_activo());
create policy parametros_admin on public.parametros
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- --- registros --------------------------------------------------------------
-- REQ 5: el historico completo es visible para todo el equipo del programa.
create policy registros_lectura on public.registros
  for select to authenticated
  using (public.es_usuario_activo());

-- Un profesor solo carga a su nombre; un admin, a nombre de cualquiera.
create policy registros_alta on public.registros
  for insert to authenticated
  with check (
    public.es_usuario_activo()
    and (public.es_admin() or profesor_id = auth.uid())
  );

-- REQ 6: el profesor corrige lo propio dentro de la ventana; el admin siempre.
create policy registros_edicion on public.registros
  for update to authenticated
  using (
    public.es_admin()
    or (
      public.es_usuario_activo()
      and profesor_id = auth.uid()
      and fecha >= current_date - public.ventana_edicion_dias()
    )
  )
  with check (
    public.es_admin()
    or (profesor_id = auth.uid()
        and fecha >= current_date - public.ventana_edicion_dias())
  );

create policy registros_baja on public.registros
  for delete to authenticated
  using (public.es_admin());

-- --- historial --------------------------------------------------------------
-- Se lee, no se escribe: las filas las pone el trigger, que corre como definer.
create policy historial_lectura on public.registros_historial
  for select to authenticated
  using (public.es_usuario_activo());

insert into public.migraciones (nombre) values ('0001_esquema.sql');


-- ===========================================================================
-- 0002_estadisticas.sql
-- ===========================================================================

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

insert into public.migraciones (nombre) values ('0002_estadisticas.sql');


commit;

-- PostgREST cachea el esquema: sin esto las tablas y las funciones nuevas no
-- se ven por la API hasta que el servicio se reinicie solo.
notify pgrst, 'reload schema';

-- Comprobacion rapida: deberia devolver las 7 funciones de indicadores.
select routine_name
  from information_schema.routines
 where routine_schema = 'public' and routine_name like 'estadisticas%'
 order by routine_name;
