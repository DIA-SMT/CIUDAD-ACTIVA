-- ============================================================================
--  Ciudad Activa — circuito de aprobación
--
--  COMO USARLO
--    1. Abri el proyecto en supabase.com
--    2. SQL Editor > New query
--    3. Pega TODO este archivo y dale Run
--
--  Va todo en una transaccion: si algo falla no queda nada a medias.
--  Se puede correr mas de una vez sin romper nada: solo da por aprobado lo
--  importado de la planilla, no lo que este esperando revision.
-- ============================================================================

begin;

-- ============================================================================
--  Circuito de aprobación
--
--  El profesor carga y la clase queda pendiente. La Dirección aprueba o
--  rechaza. Los indicadores del REQ 7 cuentan SOLO lo aprobado: de ahí salen
--  los informes del programa, y un informe no puede incluir un dato que nadie
--  revisó.
--
--  Nota de implementación: la vista v_registros NO se toca. Las siete
--  funciones de indicadores la declaran como tipo de retorno
--  (returns setof public.v_registros), así que agregarle una columna obligaría
--  a recrearlas todas. El filtro entra en fn_registros_filtrados, que es por
--  donde ya pasan las siete, y los campos de aprobación viven en una vista
--  aparte que usa la pantalla de revisión.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Estado de aprobación de cada registro
-- ---------------------------------------------------------------------------
alter table public.registros
  add column if not exists aprobacion text not null default 'pendiente',
  add column if not exists revisado_por uuid references public.perfiles (id) on delete set null,
  add column if not exists revisado_en timestamptz,
  add column if not exists motivo_rechazo text not null default '';

alter table public.registros
  drop constraint if exists ck_aprobacion;
alter table public.registros
  add constraint ck_aprobacion
  check (aprobacion in ('pendiente', 'aprobado', 'rechazado'));

-- Un rechazo sin motivo no le sirve a nadie: el profesor necesita saber por qué.
alter table public.registros
  drop constraint if exists ck_motivo_rechazo;
alter table public.registros
  add constraint ck_motivo_rechazo
  check (aprobacion <> 'rechazado' or length(btrim(motivo_rechazo)) > 0);

-- La cola de revisión se consulta seguido y siempre por este campo.
create index if not exists ix_registros_aprobacion
  on public.registros (aprobacion, fecha desc);

-- Lo importado de la planilla viene del circuito anterior: se da por aprobado.
-- La condicion por origen no es cosmetica: sin ella, volver a correr esta
-- migracion aprobaria de golpe todo lo que estuviera esperando revision.
update public.registros
   set aprobacion = 'aprobado'
 where aprobacion = 'pendiente'
   and origen = 'importacion';

comment on column public.registros.aprobacion is
  'pendiente | aprobado | rechazado. Solo lo aprobado entra en los indicadores.';

-- ---------------------------------------------------------------------------
-- Quién puede cambiar el estado de aprobación
--
-- No alcanza con una política RLS: un profesor puede editar su propio registro
-- dentro del plazo, y hay que impedir que en esa edición se apruebe solo. El
-- trigger fija los campos de aprobación a lo que ya estaban cuando quien edita
-- no es administrador.
-- ---------------------------------------------------------------------------
create or replace function public.fn_control_aprobacion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admin boolean := public.es_admin();
  -- Sin sesion es la clave de servicio: la importacion desde la planilla. No
  -- es un usuario que pueda auto-aprobarse, es el sistema cargando historico,
  -- y respeta el valor que le manden.
  sistema boolean := auth.uid() is null;
begin
  if tg_op = 'INSERT' then
    if sistema then
      return new;
    end if;
    if admin then
      -- La Dirección carga y aprueba en el mismo acto: no se revisa a sí misma.
      new.aprobacion := coalesce(nullif(new.aprobacion, 'pendiente'), 'aprobado');
      new.revisado_por := auth.uid();
      new.revisado_en := now();
    else
      new.aprobacion := 'pendiente';
      new.revisado_por := null;
      new.revisado_en := null;
      new.motivo_rechazo := '';
    end if;
    return new;
  end if;

  -- UPDATE
  if sistema then
    return new;
  end if;

  if not admin then
    if old.aprobacion = 'rechazado' then
      raise exception 'Este registro fue rechazado y no se puede modificar. Cargá uno nuevo.'
        using errcode = 'check_violation';
    end if;

    -- Un profesor no toca su propio estado de aprobación.
    new.aprobacion := old.aprobacion;
    new.revisado_por := old.revisado_por;
    new.revisado_en := old.revisado_en;
    new.motivo_rechazo := old.motivo_rechazo;

    -- Y si cambia el contenido de algo ya aprobado, vuelve a revisión: si no,
    -- alcanzaría con hacer aprobar una carga y después cambiarle los números.
    if (new.fecha, new.profesor_id, new.lugar_id, new.estado_codigo,
        new.alumnos_total, new.alumnos_nuevos, new.varones, new.mujeres,
        new.observaciones)
       is distinct from
       (old.fecha, old.profesor_id, old.lugar_id, old.estado_codigo,
        old.alumnos_total, old.alumnos_nuevos, old.varones, old.mujeres,
        old.observaciones)
    then
      new.aprobacion := 'pendiente';
      new.revisado_por := null;
      new.revisado_en := null;
      new.motivo_rechazo := '';
    end if;

  elsif new.aprobacion is distinct from old.aprobacion then
    -- Queda asentado quién revisó y cuándo.
    new.revisado_por := auth.uid();
    new.revisado_en := now();
    if new.aprobacion <> 'rechazado' then
      new.motivo_rechazo := '';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tg_control_aprobacion on public.registros;
create trigger tg_control_aprobacion
  before insert or update on public.registros
  for each row execute function public.fn_control_aprobacion();

-- ---------------------------------------------------------------------------
-- REQ 6: la aprobación también deja rastro en el historial.
-- Se reemplaza la función de auditoría de 0001 sumando los campos nuevos.
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
  campos       text[] := array[
    'fecha', 'profesor_id', 'lugar_id', 'estado_codigo', 'alumnos_total',
    'alumnos_nuevos', 'varones', 'mujeres', 'observaciones', 'email_responsable',
    'aprobacion', 'motivo_rechazo'];
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

  foreach campo in array campos loop
    execute format('select ($1).%I::text, ($2).%I::text', campo, campo)
       into anterior, nuevo using old, new;

    if anterior is distinct from nuevo then
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

-- ---------------------------------------------------------------------------
-- Vista para la pantalla de revisión: todo lo de v_registros más el estado de
-- aprobación. Se agrega aparte justamente para no alterar v_registros.
-- ---------------------------------------------------------------------------
create or replace view public.v_revision
with (security_invoker = true)
as
select
  v.*,
  r.aprobacion,
  r.revisado_por,
  s.nombre AS revisado_por_nombre,
  r.revisado_en,
  r.motivo_rechazo
from public.v_registros v
join public.registros r ON r.id = v.id
left join public.perfiles s ON s.id = r.revisado_por;

-- ---------------------------------------------------------------------------
-- REQ 7: los indicadores cuentan solo lo aprobado.
--
-- Misma firma y mismo tipo de retorno que en 0002, asi que las siete funciones
-- que la usan siguen funcionando sin tocarlas. Lo unico que cambia es que se
-- suma el join contra registros para poder filtrar por aprobacion.
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
  join public.registros r on r.id = v.id
  where r.aprobacion = 'aprobado'
    and (p_desde is null or v.fecha >= p_desde)
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

comment on function public.fn_registros_filtrados is
  'Subconjunto del REQ 8 sobre el que se calculan los indicadores. Solo cuenta '
  'los registros aprobados: de estos numeros salen los informes del programa.';

-- ---------------------------------------------------------------------------
-- Cuántas esperan revisión. El tablero lo muestra como aviso.
-- ---------------------------------------------------------------------------
create or replace function public.registros_pendientes()
returns integer
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select count(*)::integer from public.registros where aprobacion = 'pendiente';
$$;

grant execute on function public.registros_pendientes() to authenticated;
grant execute on function public.fn_registros_filtrados(date, date, uuid, bigint, text, text)
  to authenticated;

insert into public.migraciones (nombre) values ('0003_aprobacion.sql')
on conflict (nombre) do nothing;

commit;

-- PostgREST cachea el esquema: sin esto las columnas y funciones nuevas no se
-- ven por la API hasta que el servicio se reinicie solo.
notify pgrst, 'reload schema';

-- Comprobacion: los 20 registros existentes deberian salir todos aprobados.
select aprobacion, count(*) from public.registros group by aprobacion;
