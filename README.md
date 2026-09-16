# Ciudad Activa — Sistema de registro de actividades

Sistema de carga y análisis de las clases del programa **Ciudad Activa**,
dependiente de la **Dirección de Deportes y Recreación** de la Municipalidad de
San Miguel de Tucumán.

Reemplaza el formulario de Google + planilla que se venía usando, con tres
diferencias que son las que pidió la Gerencia de Datos: los profesores y los
lugares salen de listados cerrados, los números se validan al cargarlos, y todo
queda registrado con su historial de modificaciones.

**Next.js 16 (App Router) · TypeScript · Tailwind 4 · shadcn/ui · Supabase**

---

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # completar con las claves del proyecto Supabase
npm run db:migrar              # aplica supabase/migrations/
npm run db:sembrar             # catálogos y registros de muestra
npm run dev
```

Queda en `http://localhost:3000`.

### Variables de entorno

Se cargan de `.env.local`, que está en `.gitignore`. Los valores salen del panel
de Supabase, en *Project Settings*:

| variable | dónde | |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | API | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | API | clave pública; lo que protege los datos es RLS, no esta clave |
| `SUPABASE_SERVICE_ROLE_KEY` | API | **secreta**, saltea RLS; sólo para alta de usuarios y reseteo de contraseñas |
| `DATABASE_URL` | Database | conexión directa, para migraciones y carga inicial |
| `PASSWORD_INICIAL` | — | contraseña que se asigna en la carga inicial |

### Qué deja la carga inicial

11 profesores, 11 espacios, 4 estados de clase y 20 registros de muestra —los
primeros 10 de cada hoja de `Asistencia Ciudad Activa.xlsx`—, más una cuenta
administradora (`deportes@smt.gob.ar`).

**Los profesores entran con su correo electrónico**, que es el que trae la
planilla. La contraseña inicial es la de `PASSWORD_INICIAL` y el sistema obliga a
cambiarla en el primer ingreso.

---

## Las pantallas

| ruta | quién | qué |
|---|---|---|
| `/ingresar` | pública | correo y contraseña; cambio obligatorio la primera vez |
| `/` | con sesión | redirige: admin → panel, profesor → carga |
| `/carga` | profesor y admin | formulario de carga de la clase |
| `/panel` | con sesión | tablero, registros y gestión |

El formulario de carga pide los ocho datos que definió la Dirección más dos que
necesitan los indicadores:

1. Correo electrónico del responsable
2. Profesor *(del listado de autorizados)*
3. Fecha de la actividad
4. Lugar *(de los espacios definidos)*
5. Cantidad total de alumnos
6. Cantidad de varones
7. Cantidad de mujeres
8. Observaciones
9. Estado de la clase — sin esto no hay indicador de suspensiones ni de motivos
10. Alumnos nuevos — sin esto no hay indicador de alumnos nuevos

---

## Cómo se cubren los requerimientos

| # | Requerimiento | Dónde |
|---|---|---|
| 1 | Registro individual de cada actividad | tabla `registros`, una fila por clase |
| 2 | Profesores desde un listado autorizado | `perfiles.dicta_clases`; `registros.profesor_id` es clave foránea, el nombre nunca se tipea |
| 3 | Lugares desde espacios definidos | tabla `lugares`; `registros.lugar_id` es clave foránea |
| 4 | Validación (varones + mujeres = total) | `lib/validacion.ts` en el formulario y en la API, y `CHECK ck_suma_sexos` en la base |
| 5 | Registro histórico consultable | vista `v_registros` + índices por fecha, profesor y lugar |
| 6 | Modificación con permisos e historial | políticas RLS + trigger `fn_auditar_registros` |
| 7 | Estadísticas e indicadores | funciones SQL en `0002_estadisticas.sql`, pestaña Tablero |
| 8 | Filtros de consulta | `lib/consultas.ts` — una definición compartida por el listado y los indicadores |

### Permisos

| | profesor | administrador |
|---|---|---|
| Cargar una clase | sólo a su nombre | a nombre de cualquiera |
| Ver el histórico completo | sí | sí |
| Editar | lo propio, dentro de los 7 días | todo, siempre |
| Eliminar | no | sí, queda asentado en el historial |
| Gestionar profesores y lugares | no | sí |

Nada se borra de los catálogos: se **desactiva**. Deja de ofrecerse en el
formulario, pero el histórico queda intacto.

---

## Estructura

```
app/
  ingresar/       ingreso y cambio de contraseña
  carga/          formulario de carga de la clase
  panel/          tablero, registros y gestión
  api/            Route Handlers
components/ui/    shadcn/ui
lib/
  validacion.ts   REQ 4 — reglas de un registro
  consultas.ts    REQ 8 — definición única de los filtros
  tipos.ts        formas de las respuestas de la API
  fechas.ts       fechas locales y formato es-AR
  supabase/       clientes de navegador, servidor y Admin API
supabase/
  migrations/     0001 esquema, RLS y triggers · 0002 indicadores
  datos-planilla.json
scripts/          migración y carga inicial
docs/CONTRATO-API.md
```

### Decisiones técnicas

**Las reglas de negocio viven en la base.** Los permisos del requerimiento 6 son
políticas RLS y la auditoría es un trigger, no código de la aplicación. La
diferencia es concreta: si alguien agrega mañana una ruta nueva y se olvida de
escribir el historial, el cambio igual queda asentado. Si el código fuera el
único guardián, no.

**Las validaciones están tres veces a propósito** — en el formulario, en la API
y en la base. La del formulario es para que el profesor no se equivoque; la de
la API, porque el formulario se puede saltear; la de la base, porque una
importación o una consulta directa también se pueden equivocar.

**Una sola definición de los filtros.** El listado y todos los indicadores leen
los filtros de `lib/consultas.ts`. Si cada uno los interpretara por su cuenta, el
tablero podría contar un conjunto de clases y la tabla mostrar otro —la peor
falla posible en un sistema que se usa para informar.

**Los indicadores son funciones SQL**, no agregaciones en JavaScript. Se calculan
donde están los datos y RLS sigue aplicando, porque son `security invoker`.

---

## Carga masiva desde la planilla

`supabase/datos-planilla.json` tiene los **559 registros** de la planilla, extraídos
con `scripts/extraer-planilla.py`. Antes de cargarlos, simulá:

```bash
npm run db:simular
```

Recorre toda la planilla y dice exactamente qué haría —cuántos entrarían, cuáles
ya están y cuáles quedarían afuera— **sin escribir una sola fila**. Cuando el
resultado convenza:

```bash
npm run db:sembrar
```

Es idempotente: la deduplicación va por la marca temporal del formulario, que
identifica cada envío. Se puede correr las veces que haga falta.

### Lo que hay que saber de esos datos

**Las dos hojas no son 966 registros.** La hoja `BD` resultó ser un subconjunto
completo de `Respuestas de formulario`: sus 389 filas están todas en la otra.
El universo real es de 559 registros únicos.

**La columna "Estado de la clase" se agregó al formulario el 11/05/2026.** Los
360 registros anteriores no la tienen, y 57 de ellos describen una suspensión en
las observaciones. Importarlos todos como "Clase normal" haría que el tablero
mostrara cero suspensiones en todo el primer año del programa y contara como
dadas 57 clases que nunca se dictaron.

Por eso el estado se deduce, con esta regla:

- Si la planilla lo declara, se respeta.
- Si no, y **hubo alumnos**, la clase se dio: `Clase normal`.
- Si no, y **no hubo nadie**, se busca el motivo en las observaciones:
  feriado → `Suspendida por feriado`; lluvia, tormenta o clima →
  `Suspendida por factores climáticos`; otra mención de suspensión →
  `Suspendida por otro motivo`.
- Sin ninguna pista, la clase se cuenta como dada sin asistentes.

La diferencia no es menor: **467 realizadas y 92 suspendidas** con la regla,
contra 527 y 32 sin ella. La carga informa cuántos estados dedujo.

**Seis registros quedan afuera** porque los números no cierran (requisito 4).
Se listan al final de la carga con el detalle; corregilos en la planilla,
regenerá el JSON y volvé a correr.

---

## Sobre los datos de la planilla original

Al procesar la planilla aparecieron los problemas que el sistema viene a evitar:

- **Nombres tipeados distinto** entre cargas: `Prof. Nicolas Suaya` y
  `Prof. Nicolás Suaya` son la misma persona. Lo resuelve el listado cerrado del REQ 2.
- **Correos cruzados**: una misma dirección cargando a nombre de tres profesores
  distintos. Lo resuelve ligar cada carga a la cuenta que la hizo.
- **Sumas que no cierran**: filas donde varones + mujeres no da el total
  declarado. Lo resuelve el REQ 4. La carga inicial informa y omite las filas
  incoherentes en lugar de importarlas en silencio.

Un dato para tener presente al mostrar el tablero: en la muestra cargada hay
**21 varones contra 755 mujeres**. No es un error de carga; el programa es
mayoritariamente femenino y el indicador de distribución por sexo lo va a
reflejar.
