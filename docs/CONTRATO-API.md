# Contrato — Ciudad Activa (Next.js + Supabase)

Documento normativo. Todo se construye contra esto.

## Arquitectura

- **Next.js 16, App Router, TypeScript.** Tailwind 4 + shadcn/ui.
- **Supabase**: Postgres + Auth. El esquema está en `supabase/migrations/`.
- **Los permisos los aplica la base**, no la aplicación: políticas RLS sobre
  `registros` y `perfiles`. Los Route Handlers usan el cliente con la sesión del
  usuario (`clienteServidor()`), nunca la clave de servicio, para que RLS corra
  y `auth.uid()` esté disponible.
- **La auditoría del REQ 6 la escribe un trigger** (`fn_auditar_registros`), no
  el código. Ningún camino puede modificar un registro sin dejar rastro.
- La clave de servicio (`clienteAdministrador()`) se usa **sólo** para alta de
  usuarios y reseteo de contraseñas, que son operaciones de la Admin API.

### Identificadores

`profesor_id` y `cargado_por` son **uuid** (vienen de `auth.users`).
`lugar_id` es **bigint**. `estado_codigo` es **text**.

## Convenciones de la API

- Error: `{ error: string, errores?: Record<string,string>, duplicados?: Registro[] }`
- Códigos: 200 · 201 · 400 · 401 · 403 · 404 · 409 (duplicado) · 422 (validación) · 500
- Los Route Handlers van en `app/api/**/route.ts` y exportan `GET`/`POST`/`PATCH`/`DELETE`.
- Texto de cara al usuario **en español rioplatense** (vos/tenés/cargá).
- El middleware (`middleware.ts`) ya responde 401 a `/api/*` sin sesión.
  Igual, cada handler vuelve a pedir la sesión con `sesionActual()`.

## Autenticación

No hay rutas propias de login: lo resuelve `@supabase/ssr` desde el cliente.

- Ingreso: `supabase.auth.signInWithPassword({ email, password })`
- Salida: `supabase.auth.signOut()`
- Cambio de contraseña: `supabase.auth.updateUser({ password })`
- Perfil del usuario en el servidor: `sesionActual()` de `lib/supabase/servidor.ts`

**Los profesores entran con su correo electrónico**, que es el que trae la planilla.

El primer ingreso obliga a cambiar la contraseña. Se marca con
`user_metadata.debe_cambiar_password = true`, que la carga inicial pone en true
y la pantalla de cambio pone en false.

## Filtros comunes (REQ 8)

Query string aceptado por el listado, la exportación y **todos** los indicadores:

| parámetro | ejemplo | |
|---|---|---|
| `desde` | `2026-01-01` | fecha de la actividad, inclusive |
| `hasta` | `2026-09-30` | fecha de la actividad, inclusive |
| `profesor_id` | uuid | REQ 8 |
| `lugar_id` | `2` | REQ 8 |
| `estado` | `susp_clima` | REQ 8 |
| `q` | `lluvia` | busca en observaciones, profesor y lugar |

Se leen con `filtrosDeQuery(searchParams)` de `lib/consultas.ts`. **Usar siempre
esa función**: es la única definición, y garantiza que el listado y los
indicadores miren el mismo subconjunto.

## `/api/catalogos`

`GET` → `{ profesores: [{id, nombre, cargo, email}], lugares: [{id, nombre}], estados: [{codigo, nombre, es_suspension}] }`

Sólo activos. `profesores` = `activo AND dicta_clases`, ordenados por nombre.
Es el listado de autorizados del REQ 2 y los espacios del REQ 3.

## `/api/registros`

| método | ruta | |
|---|---|---|
| GET | `/api/registros` | listado paginado con los filtros comunes |
| POST | `/api/registros` | alta |
| GET | `/api/registros/[id]` | uno |
| PATCH | `/api/registros/[id]` | edición |
| DELETE | `/api/registros/[id]` | baja (RLS la limita a admin) |
| GET | `/api/registros/[id]/historial` | REQ 6 |
| GET | `/api/registros/exportar` | CSV, mismos filtros, sin paginar |

**GET** query extra: `pagina` (1), `por_pagina` (25, máx 200), `orden` ∈
`fecha_desc` (def.) · `fecha_asc` · `alumnos_desc` · `creado_desc`.
→ `{ datos: Registro[], total, pagina, por_pagina, paginas }`
Se consulta la vista `v_registros` con `.select('*', { count: 'exact' })`.

**POST** — valida con `validarRegistro()` de `lib/validacion.ts` (REQ 4).
- Si falta `email_responsable`, se usa el de la sesión.
- Si ya existe un registro con la misma fecha + profesor + lugar y no vino
  `confirmar_duplicado: true` → **409** `{ error, duplicados }`. Hay días con
  dos clases reales, así que se avisa, no se bloquea.
- `cargado_por` = usuario de la sesión. `origen` = `'web'`.
- 201 `{ registro }`. **No escribir el historial**: lo hace el trigger.
- Si RLS rechaza (un profesor cargando a nombre de otro), Supabase devuelve el
  código `42501` → traducirlo a **403** con un mensaje que explique el motivo.

**PATCH** — mismas validaciones. Los permisos del REQ 6 los aplica RLS: un
profesor sólo puede editar lo propio y dentro de la ventana
(`parametros.ventana_edicion_dias`, 7 días). Si la actualización afecta 0 filas,
es porque RLS la bloqueó → 403 explicando que venció el plazo y que puede
pedirle el cambio a la Dirección.

**DELETE** — RLS la limita a admin. 0 filas afectadas → 403.

**GET historial** → `{ historial: EntradaHistorial[] }`, más reciente primero,
con `etiqueta_campo` resuelta con `ETIQUETAS_CAMPOS` de `lib/validacion.ts`.

**GET exportar** → `text/csv; charset=utf-8`, BOM `﻿`, separador `;`,
cabeceras en español, `Content-Disposition: attachment; filename="ciudad-activa-<fecha>.csv"`.

## `/api/estadisticas` (REQ 7)

Los indicadores son **funciones SQL** definidas en
`supabase/migrations/0002_estadisticas.sql` y se llaman con `supabase.rpc()`.
Son `security invoker`, así que RLS sigue aplicando.

Todas reciben los mismos parámetros:

```
p_desde date, p_hasta date, p_profesor uuid, p_lugar bigint, p_estado text, p_q text
```

(`null` = sin filtrar). `estadisticas_evolucion`, `estadisticas_sexo` y
`estadisticas_tablero` reciben además `p_agrupar text` ∈ `dia` · `semana` · `mes`
(por defecto `mes`), porque las tres devuelven una serie por período. Sus rutas
tienen que pasarlo: si se deja caer en el valor por defecto, un gráfico queda en
meses mientras el de al lado muestra días.

| función SQL | ruta | devuelve |
|---|---|---|
| `estadisticas_resumen` | `/api/estadisticas/resumen` | `Resumen` |
| `estadisticas_por_profesor` | `/api/estadisticas/por-profesor` | `FilaProfesor[]` |
| `estadisticas_por_lugar` | `/api/estadisticas/por-lugar` | `FilaLugar[]` |
| `estadisticas_evolucion` | `/api/estadisticas/evolucion` | `PuntoEvolucion[]` |
| `estadisticas_sexo` | `/api/estadisticas/sexo` | `DistribucionSexo` |
| `estadisticas_suspensiones` | `/api/estadisticas/suspensiones` | `Suspensiones` |
| `estadisticas_tablero` | `/api/estadisticas/tablero` | `Tablero` |

Las formas exactas están en `lib/tipos.ts` y son de cumplimiento obligatorio.

**Reglas de cálculo, únicas para todo el sistema:**

- **Clase realizada** = `es_suspension = false`. **Clase registrada** = todas.
- Alumnos, promedios y distribución por sexo se calculan **sólo sobre clases
  realizadas**.
- Los porcentajes se calculan en SQL, redondeados a un decimal, y valen `0`
  cuando el denominador es 0. Nunca `null`, `NaN` ni división por cero.
- `estadisticas_por_lugar` incluye `ultima_clase` (`max(fecha)` de realizadas):
  es el indicador de "nivel de actividad de cada espacio".
- `estadisticas_suspensiones.detalle` trae las observaciones, que es donde el
  profesor escribe el motivo concreto. Máximo 200 filas, más recientes primero.
- `estadisticas_evolucion` devuelve la serie en orden cronológico ascendente.
  Un período sin clases no se inventa.

Cobertura de los indicadores pedidos: clases realizadas · alumnos registrados ·
alumnos nuevos · distribución por sexo · clases por profesor · alumnos por
profesor · alumnos por lugar · promedio por clase · evolución de la matrícula ·
cantidad y porcentaje de suspendidas · motivos de suspensión · nivel de
actividad de cada espacio · evolución de la participación por período.

## `/api/admin` — sólo rol `admin`

| método | ruta | |
|---|---|---|
| GET | `/api/admin/usuarios` | todos, incluidos inactivos |
| POST | `/api/admin/usuarios` | alta `{nombre, cargo, email, rol, dicta_clases}` — crea el usuario en Supabase Auth con `clienteAdministrador()` y contraseña generada, que se devuelve **una sola vez** |
| PATCH | `/api/admin/usuarios/[id]` | `{nombre, cargo, rol, dicta_clases, activo}` |
| POST | `/api/admin/usuarios/[id]/password` | reset; devuelve la nueva contraseña una sola vez y deja `debe_cambiar_password = true` |
| GET | `/api/admin/lugares` | todos, incluidos inactivos |
| POST | `/api/admin/lugares` | alta `{nombre, descripcion, orden}` |
| PATCH | `/api/admin/lugares/[id]` | `{nombre, descripcion, activo, orden}` |
| GET | `/api/admin/historial` | auditoría global paginada; filtros `registro_id`, `usuario_id`, `desde`, `hasta`, `pagina`, `por_pagina` |

Reglas: un admin no puede desactivarse ni quitarse el rol a sí mismo, y no se
puede dejar el sistema sin ningún admin activo. **Nada se elimina**: usuarios y
lugares se desactivan, para no romper el histórico del REQ 5. Al desactivar un
lugar o profesor con registros, se permite pero la respuesta informa cuántos
registros quedan asociados.

## Pantallas

| ruta | quién | qué |
|---|---|---|
| `/ingresar` | pública | correo y contraseña; cambio obligatorio la primera vez |
| `/` | con sesión | redirige: admin → `/panel`, profesor → `/carga` |
| `/carga` | profesor y admin | formulario de carga de la clase |
| `/panel` | con sesión | tablero, registros y gestión (gestión sólo admin) |

Server Components para lo que se puede resolver en el servidor; `'use client'`
sólo donde hace falta interacción. Los gráficos, con el componente `chart` de
shadcn (recharts), que ya está en `components/ui/chart.tsx`.
