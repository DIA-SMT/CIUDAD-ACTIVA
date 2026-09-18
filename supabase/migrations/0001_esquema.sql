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
   'Cuántos días tiene un profesor para corregir una carga propia. Se cuenta desde la fecha de la clase. La Dirección no tiene límite.');

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
