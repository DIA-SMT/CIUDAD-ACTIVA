# Ciudad Activa — Sistema de registro de actividades

Sistema de carga y análisis de las clases del programa **Ciudad Activa**,
dependiente de la **Dirección de Deportes y Recreación** de la Municipalidad de
San Miguel de Tucumán.

Reemplaza el formulario de Google + planilla que se venía usando, con tres
diferencias que son las que pidió la Gerencia de Datos: los profesores y los
lugares salen de listados cerrados (no se escriben a mano), los números se
validan al cargarlos, y todo queda registrado con su historial de modificaciones.

---

## Puesta en marcha

```bash
npm install
npm run init-db
npm start
```

Queda en `http://localhost:3000`.

`npm run init-db` crea la base y la deja cargada con:

| | |
|---|---|
| Profesores | 11, tomados de la planilla `Asistencia Ciudad Activa.xlsx` |
| Lugares | 11 espacios reales del programa |
| Estados de clase | normal, suspendida por clima, por feriado, por otro motivo |
| Registros de muestra | 20 — los primeros 10 de cada hoja de la planilla |
| Cuenta administradora | usuario `admin` |

La contraseña inicial de **todas** las cuentas es la de `SEED_PASSWORD`
(`ciudadactiva2026` por defecto). El sistema obliga a cambiarla en el primer
ingreso. El listado completo de usuarios se imprime al terminar la carga.

Para reconstruir la base desde cero: `npm run reset-db`.

### Configuración

Copiá `.env.example` a `.env` y ajustá lo que haga falta:

| variable | por defecto | para qué |
|---|---|---|
| `PORT` | `3000` | puerto del servidor |
| `DB_PATH` | `./data/ciudad-activa.db` | archivo SQLite |
| `SESSION_SECRET` | — | **cambiar en producción** |
| `SESSION_HORAS` | `12` | duración de la sesión |
| `SEED_PASSWORD` | `ciudadactiva2026` | contraseña inicial de la carga inicial |
| `VENTANA_EDICION_DIAS` | `7` | días que tiene un profesor para corregir su propia carga |

---

## Las tres pantallas

**Ingreso** (`/`) — usuario o correo y contraseña. Cambio de contraseña
obligatorio la primera vez.

**Carga de la clase** (`/carga.html`) — la pantalla del profesor, pensada para
completarse desde el teléfono, parado en la plaza. Los ocho datos que pidió la
Dirección más los dos que necesitan los indicadores:

1. Correo electrónico del responsable
2. Profesor *(del listado de autorizados)*
3. Fecha de la actividad
4. Lugar *(de los espacios definidos)*
5. Cantidad total de alumnos
6. Cantidad de varones
7. Cantidad de mujeres
8. Observaciones
9. Estado de la clase — necesario para los indicadores de suspensiones
10. Alumnos nuevos — necesario para el indicador de alumnos nuevos

**Panel** (`/admin.html`) — tablero de indicadores, listado histórico con
filtros, edición con historial, exportación a CSV y gestión de profesores,
lugares y auditoría.

---

## Cómo se cubren los requerimientos

| # | Requerimiento | Dónde está resuelto |
|---|---|---|
| 1 | Registro individual de cada actividad | tabla `registros`, una fila por clase |
| 2 | Identificación de profesores por listado autorizado | `usuarios.dicta_clases`; `registros.profesor_id` es clave foránea, el nombre nunca se tipea |
| 3 | Identificación de lugares por espacios definidos | tabla `lugares`; `registros.lugar_id` es clave foránea |
| 4 | Validación de datos (varones + mujeres = total) | `src/lib/validacion.js` en la API, en vivo en el formulario, y `CHECK ck_suma_sexos` en la base |
| 5 | Registro histórico consultable por fecha, profesor y lugar | vista `v_registros` + índices; filtros en el panel |
| 6 | Modificación con permisos e historial | ventana de edición por rol + tabla `registros_historial`, una fila por campo modificado |
| 7 | Estadísticas e indicadores | `/api/estadisticas/*`, pestaña Tablero |
| 8 | Filtros de consulta | `filtrosRegistros()` — una sola definición que usan el listado **y** todos los indicadores |

### Permisos

| | profesor | administrador |
|---|---|---|
| Cargar una clase | sí, sólo a su nombre | sí, a nombre de cualquiera |
| Ver el histórico completo | sí | sí |
| Editar | sólo lo propio, dentro de la ventana de edición | todo, siempre |
| Eliminar | no | sí, queda asentado en el historial |
| Gestionar profesores y lugares | no | sí |

Nada se borra de los catálogos: los profesores y los lugares se **desactivan**,
así dejan de ofrecerse en el formulario pero el histórico queda intacto.

---

## Estructura

```
src/
  server.js              punto de entrada
  config.js              configuración y .env
  db/
    schema.sql           esquema, con las validaciones como CHECK
    index.js             capa de datos y definición única de los filtros
    seed.js              carga inicial
    seed-data.json       catálogos y registros extraídos de la planilla
  lib/
    validacion.js        REQ 4 — reglas de un registro
    passwords.js         hash scrypt y reglas de contraseña
    fechas.js            fechas locales en texto ordenable
  middleware/            sesión, permisos y manejo de errores
  routes/                auth · catálogos · registros · estadísticas · admin
public/                  las tres pantallas, sin framework ni build
docs/CONTRATO-API.md     contrato de la API
```

### Decisiones técnicas

**SQLite con `node:sqlite`.** Sin dependencias binarias ni servidor de base de
datos que administrar: la base es un archivo que se copia para respaldarla. El
volumen lo justifica —el programa lleva unos 570 registros en dos años—. Todo el
acceso a datos pasa por `src/db/index.js`, así que migrar a MySQL o PostgreSQL es
cambiar ese archivo, no el sistema.

**Una sola dependencia npm: Express.** Sesiones, hash de contraseñas y parseo de
cookies se resuelven con el runtime (`node:crypto`, `node:sqlite`). En un sistema
municipal que va a vivir años con mantenimiento esporádico, cada dependencia es
una deuda.

**Sin paso de build en el frontend.** HTML y módulos ES servidos tal cual. Se
edita y se ve; no hay que reconstruir nada para cambiar un texto.

**Las validaciones están tres veces a propósito** — en el formulario, en la API y
en la base. La del formulario es para que el profesor no se equivoque; la de la
API, porque el formulario se puede saltear; la de la base, porque una importación
o un script también se pueden equivocar.

---

## Respaldo

La base es un único archivo. Con el servidor detenido:

```bash
cp data/ciudad-activa.db respaldos/ciudad-activa-$(date +%F).db
```

Con el servidor andando, usar `sqlite3 data/ciudad-activa.db ".backup respaldo.db"`
para no copiar una base a medio escribir.

---

## Sobre los datos de la planilla original

La carga inicial toma los catálogos completos y una muestra de 20 registros. Al
procesar la planilla aparecieron los problemas que el sistema viene a evitar:

- **Nombres de profesor tipeados distinto** entre cargas (`Prof. Nicolas Suaya` y
  `Prof. Nicolás Suaya` son la misma persona). Resuelto con el listado cerrado del REQ 2.
- **Correos cruzados**: una misma dirección cargando a nombre de tres profesores
  distintos. Resuelto al ligar cada carga a la cuenta que la hizo.
- **Sumas que no cierran**: filas donde varones + mujeres no da el total declarado.
  Resuelto con el REQ 4. La carga inicial informa y omite las filas incoherentes
  en lugar de importarlas en silencio.
