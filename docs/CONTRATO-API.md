# Contrato de la API — Ciudad Activa

Documento normativo. Backend y frontend se construyen contra esto.

## Convenciones

- Todo bajo `/api`. Respuestas y cuerpos en JSON (`Content-Type: application/json`).
- Autenticación por cookie `ca_sesion` (httpOnly, sameSite=lax, path=/).
- Error estándar: `{ "error": "mensaje para el usuario", "errores": { "campo": "detalle" } }`
  (`errores` sólo en validaciones, 422).
- Códigos: 200 ok · 201 creado · 400 pedido mal formado · 401 sin sesión ·
  403 sin permiso · 404 no existe · 409 conflicto (duplicado) · 422 validación · 500 error interno.
- Cada archivo de rutas exporta por defecto un `Router` de Express.
- Texto de cara al usuario **en español**. Sin `console.log` en producción.

## Tipos

```
Perfil        { id, nombre, cargo, email, usuario, rol, dicta_clases, debe_cambiar_password }
Registro      { id, fecha, profesor_id, profesor_nombre, profesor_cargo,
                lugar_id, lugar_nombre, estado_codigo, estado_nombre, es_suspension,
                alumnos_total, alumnos_nuevos, varones, mujeres,
                observaciones, email_responsable, origen,
                cargado_por, cargado_por_nombre, creado_en, actualizado_en,
                anio, mes, periodo }     // tal cual la vista v_registros
CuerpoRegistro{ fecha, profesor_id, lugar_id, estado_codigo,
                alumnos_total, alumnos_nuevos, varones, mujeres,
                observaciones, email_responsable, confirmar_duplicado? }
```

## Filtros comunes (REQ 8)

Aceptados como query string por el listado, la exportación y **todas** las estadísticas:

| parámetro     | ejemplo      | significado                                  |
|---------------|--------------|----------------------------------------------|
| `desde`       | `2026-01-01` | fecha de la actividad, inclusive             |
| `hasta`       | `2026-09-30` | fecha de la actividad, inclusive             |
| `profesor_id` | `4`          | REQ 8 – profesor                             |
| `lugar_id`    | `2`          | REQ 8 – lugar                                |
| `estado`      | `susp_clima` | REQ 8 – estado de la clase                   |
| `q`           | `lluvia`     | busca en observaciones, profesor y lugar     |

Se traducen con `filtrosRegistros(query)` de `src/db/index.js`. **Usar siempre esa función**:
es la única definición de los filtros, y garantiza que el listado y los indicadores
miren exactamente el mismo subconjunto.

## `/api/auth`

| método | ruta        | sesión | cuerpo / query          | respuesta |
|--------|-------------|--------|-------------------------|-----------|
| POST   | `/login`    | no     | `{usuario, password}`   | `{usuario: Perfil}` · 401 si no coincide |
| POST   | `/logout`   | sí     | —                       | `{ok:true}` |
| GET    | `/sesion`   | no     | —                       | `{usuario: Perfil}` · 401 si no hay sesión |
| POST   | `/password` | sí     | `{actual, nueva}`       | `{ok:true}` · 422 si `nueva` no cumple reglas |

- `usuario` en el login acepta **nombre de usuario o correo**.
- Tras 8 intentos fallidos del mismo usuario en 15 minutos se responde 429 durante 15 minutos.
- El login actualiza `ultimo_acceso`. `/password` pone `debe_cambiar_password = 0`.
- Nunca se devuelve `password_hash`.

## `/api/catalogos` — requiere sesión

`GET /` → `{ profesores: [{id, nombre, cargo, email}], lugares: [{id, nombre}], estados: [{codigo, nombre, es_suspension}] }`

Sólo elementos activos. `profesores` = `activo = 1 AND dicta_clases = 1`, ordenados por nombre.
Es el listado de autorizados del REQ 2 y los espacios del REQ 3.

## `/api/registros` — requiere sesión

| método | ruta            | permiso | descripción |
|--------|-----------------|---------|-------------|
| GET    | `/`             | sesión  | listado paginado con los filtros comunes |
| POST   | `/`             | sesión  | alta |
| GET    | `/:id`          | sesión  | uno |
| PUT    | `/:id`          | ver abajo | edición |
| DELETE | `/:id`          | admin   | baja |
| GET    | `/:id/historial`| sesión  | REQ 6 |
| GET    | `/exportar.csv` | sesión  | mismos filtros, sin paginar |

**GET /** query extra: `pagina` (1), `por_pagina` (25, máx 200),
`orden` ∈ `fecha_desc` (por defecto) · `fecha_asc` · `alumnos_desc` · `creado_desc`.
→ `{ datos: Registro[], total, pagina, por_pagina, paginas }`

**POST /** — valida con `validarRegistro()` de `src/lib/validacion.js` (REQ 4).
- Un `profesor` sólo puede cargar con `profesor_id` igual al suyo; un `admin`, cualquiera.
- Si falta `email_responsable`, se usa el del usuario de la sesión.
- Si ya existe un registro con la misma fecha + profesor + lugar y no vino
  `confirmar_duplicado: true` → **409** `{error, duplicados: Registro[]}`.
  Con `confirmar_duplicado: true` se graba igual (hay días con dos clases reales).
- Éxito → 201 `{registro: Registro}` y asiento `creacion` en el historial.

**PUT /:id** — mismas validaciones. Permisos (REQ 6):
- `admin`: siempre.
- `profesor`: sólo registros propios (`profesor_id` o `cargado_por` suyos) y sólo si la
  fecha de la clase no tiene más de `config.ventanaEdicionProfesorDias` días. Si no, 403
  con un mensaje que explique el motivo. Un profesor no puede reasignar el registro a otro profesor.
- Escribe **una fila por campo modificado** en `registros_historial`
  (usar `CAMPOS_AUDITABLES` y `ETIQUETAS_CAMPOS` de `src/lib/validacion.js`).

**DELETE /:id** — sólo admin. Antes de borrar, asiento `eliminacion` con el contenido previo.

**GET /:id/historial** → `{ historial: [{id, accion, campo, etiqueta_campo, valor_anterior, valor_nuevo, usuario_nombre, fecha_hora}] }`, más reciente primero.

**GET /exportar.csv** → `text/csv; charset=utf-8`, con BOM `﻿` y separador `;`
(para que Excel en español lo abra en columnas), cabeceras en español,
`Content-Disposition: attachment; filename="ciudad-activa-<fecha>.csv"`.

## `/api/estadisticas` — requiere sesión (REQ 7)

Todas aceptan los filtros comunes. En todas, **clase realizada = `es_suspension = 0`**;
los promedios y totales de alumnos se calculan sólo sobre clases realizadas.
Los porcentajes se devuelven ya calculados, con un decimal, y valen `0` si el denominador es 0.

| ruta            | respuesta |
|-----------------|-----------|
| `/resumen`      | `{clases_registradas, clases_realizadas, clases_suspendidas, porcentaje_suspendidas, alumnos_total, alumnos_nuevos, varones, mujeres, porcentaje_varones, porcentaje_mujeres, promedio_por_clase, profesores_activos, lugares_activos, primera_fecha, ultima_fecha}` |
| `/por-profesor` | `[{profesor_id, profesor, cargo, clases, alumnos, alumnos_nuevos, promedio, suspendidas}]` ordenado por alumnos desc |
| `/por-lugar`    | `[{lugar_id, lugar, clases, alumnos, alumnos_nuevos, promedio, suspendidas, ultima_clase}]` ordenado por alumnos desc |
| `/evolucion`    | query `agrupar` ∈ `dia`·`semana`·`mes` (def. `mes`) → `[{periodo, etiqueta, clases, alumnos, alumnos_nuevos, promedio}]` en orden cronológico |
| `/sexo`         | `{varones, mujeres, porcentaje_varones, porcentaje_mujeres, por_periodo: [{periodo, etiqueta, varones, mujeres}]}` |
| `/suspensiones` | `{total, porcentaje, por_motivo: [{codigo, nombre, cantidad, porcentaje}], por_lugar: [{lugar, cantidad}], detalle: [{id, fecha, lugar, profesor, estado_nombre, observaciones}]}` |
| `/tablero`      | `{resumen, por_profesor, por_lugar, evolucion, sexo, suspensiones}` — compone las anteriores en una sola llamada; es la que usa el panel |

Cobertura de los indicadores pedidos: cantidad de clases realizadas · alumnos registrados ·
alumnos nuevos · distribución por sexo · clases por profesor · alumnos por profesor ·
alumnos por lugar · promedio por clase · evolución de la matrícula · cantidad y porcentaje
de clases suspendidas · motivos de suspensión · nivel de actividad de cada espacio ·
evolución de la participación por período.

## `/api/admin` — requiere rol `admin`

| método | ruta                    | descripción |
|--------|-------------------------|-------------|
| GET    | `/usuarios`             | todos, incluidos inactivos, sin `password_hash` |
| POST   | `/usuarios`             | alta `{nombre, cargo, email, usuario, rol, dicta_clases, password}` |
| PUT    | `/usuarios/:id`         | edita `{nombre, cargo, email, usuario, rol, dicta_clases, activo}` |
| POST   | `/usuarios/:id/password`| reset `{nueva}` → deja `debe_cambiar_password = 1` |
| GET    | `/lugares`              | todos, incluidos inactivos |
| POST   | `/lugares`              | alta `{nombre, descripcion, orden}` |
| PUT    | `/lugares/:id`          | edita `{nombre, descripcion, activo, orden}` |
| GET    | `/historial`            | auditoría global; query `registro_id`, `usuario_id`, `desde`, `hasta`, `pagina`, `por_pagina` |

Reglas: un admin no puede desactivarse ni quitarse el rol a sí mismo; no se puede
desactivar al último admin activo. Un lugar o usuario con registros asociados **no se
elimina**, se desactiva (`activo = 0`): deja de ofrecerse en el formulario pero el
histórico del REQ 5 queda intacto.

## Frontend

Tres páginas estáticas servidas desde `public/`:

- `index.html` — ingreso (usuario y contraseña) y cambio de contraseña obligatorio la primera vez.
- `carga.html` — formulario de carga de la clase. Es la pantalla del profesor.
- `admin.html` — panel: tablero de indicadores, listado con filtros, edición, historial y gestión.

Todas usan `public/js/api.js` (cliente HTTP compartido) y `public/css/estilos.css`.
Sin framework ni paso de build. Los gráficos, con Chart.js desde CDN.
