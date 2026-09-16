// Carga inicial de la base: estados de clase, lugares, usuarios y los registros
// historicos que vinieron de la planilla "Asistencia Ciudad Activa.xlsx".
//
// Se corre con "npm run db:sembrar" y es idempotente: correrlo dos veces no
// duplica nada. Node ejecuta el TypeScript directo (--experimental-strip-types),
// asi que aca no entra nada de Next: solo modulos de node: y dependencias ya
// instaladas.
//
// Los usuarios se crean con la Admin API de Supabase. El perfil de public.perfiles
// lo escribe el trigger tg_nuevo_usuario de la migracion 0001, no este script.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// El especificador del cliente administrador va en una constante y el tipo se
// pide aparte: Node necesita la extension .ts para resolver el archivo y tsc la
// rechaza salvo que se habilite allowImportingTsExtensions, que es del tsconfig
// de la aplicacion y no se toca desde aca.
type ModuloAdministrador = typeof import('../lib/supabase/administrador');
type ClienteAdmin = ReturnType<ModuloAdministrador['clienteAdministrador']>;

const RUTA_ADMINISTRADOR = '../lib/supabase/administrador.ts';

// ---------------------------------------------------------------------------
// Forma de supabase/datos-planilla.json
// ---------------------------------------------------------------------------

interface ProfesorPlanilla {
  etiqueta: string;
  nombre: string;
  cargo: string;
  email: string;
  usuario: string;
}

interface LugarPlanilla {
  nombre: string;
  registros_historicos: number;
}

interface RegistroPlanilla {
  origen: string;
  marca_temporal: string;
  email_responsable: string;
  profesor: string;
  fecha: string;
  lugar: string;
  alumnos_total: number;
  alumnos_nuevos: number;
  varones: number;
  mujeres: number;
  estado_clase: string;
  observaciones: string;
}

interface Planilla {
  profesores: ProfesorPlanilla[];
  lugares: LugarPlanilla[];
  estados_clase: string[];
  registros: RegistroPlanilla[];
}

// ---------------------------------------------------------------------------
// Semillas
// ---------------------------------------------------------------------------

interface EstadoSemilla {
  codigo: string;
  nombre: string;
  es_suspension: boolean;
  orden: number;
}

// Los tres primeros son los que trae la planilla, escritos igual que ahi para
// que la importacion de los registros historicos los resuelva por nombre. El
// cuarto se agrega para cubrir las suspensiones que no son ni clima ni feriado.
const ESTADOS: EstadoSemilla[] = [
  { codigo: 'normal', nombre: 'Clase normal', es_suspension: false, orden: 1 },
  { codigo: 'susp_clima', nombre: 'Suspendida por factores climaticos', es_suspension: true, orden: 2 },
  { codigo: 'susp_feriado', nombre: 'Suspendida por feriado', es_suspension: true, orden: 3 },
  { codigo: 'susp_otro', nombre: 'Suspendida por otro motivo', es_suspension: true, orden: 4 },
];

interface UsuarioSemilla {
  nombre: string;
  cargo: string;
  email: string;
  rol: 'admin' | 'profesor';
  dicta_clases: boolean;
}

/** Cuenta institucional de la Dirección, además del listado de la planilla. */
const USUARIO_INSTITUCIONAL: UsuarioSemilla = {
  nombre: 'Administrador del sistema',
  cargo: 'Administración',
  email: 'deportes@smt.gob.ar',
  rol: 'admin',
  dicta_clases: false,
};

const ORIGEN_VARIABLES: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'Project Settings > API (URL del proyecto)',
  SUPABASE_SERVICE_ROLE_KEY: 'Project Settings > API (clave service_role, secreta)',
  PASSWORD_INICIAL: 'la elegís vos; mirá el ejemplo en .env.example',
};

const RUTA_PLANILLA = fileURLToPath(
  new URL('../supabase/datos-planilla.json', import.meta.url),
);

// ---------------------------------------------------------------------------
// Entorno
// ---------------------------------------------------------------------------

try {
  process.loadEnvFile('.env.local');
} catch {
  // Si .env.local no esta, seguimos: las variables pueden venir del entorno del
  // sistema. La comprobacion de mas abajo avisa si igual falta alguna.
}

function exigirVariables<N extends string>(nombres: readonly N[]): Record<N, string> {
  const valores = {} as Record<N, string>;
  const faltan: N[] = [];

  for (const nombre of nombres) {
    const valor = process.env[nombre]?.trim();
    if (valor) valores[nombre] = valor;
    else faltan.push(nombre);
  }

  if (faltan.length > 0) {
    console.error('\nNo puedo seguir: faltan variables de entorno en .env.local.\n');
    for (const nombre of faltan) {
      console.error(`  • ${nombre} — ${ORIGEN_VARIABLES[nombre] ?? 'revisá .env.example'}`);
    }
    console.error(
      '\nCopiá .env.example como .env.local y completá los valores del proyecto\n' +
      'de Supabase. El archivo está en .gitignore: las claves no se suben.\n',
    );
    process.exit(1);
  }

  return valores;
}

// ---------------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------------

const cuentas = {
  estados: { creados: 0, existentes: 0 },
  lugares: { creados: 0, existentes: 0 },
  usuarios: { creados: 0, existentes: 0, fallidos: 0 },
  registros: { creados: 0, existentes: 0, omitidos: 0, fallidos: 0 },
};

function marca(estado: string): string {
  return `  ${estado.padEnd(10)}`;
}

/** Sin acentos, sin mayúsculas y sin espacios al borde: sirve para cotejar. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function correo(texto: string): string {
  return texto.trim().toLowerCase();
}

/** '2026-09-08' -> '08/09/2026' */
function fechaLegible(iso: string): string {
  const [anio, mes, dia] = String(iso).slice(0, 10).split('-');
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : String(iso);
}

function servidorDe(url: string): string {
  try {
    return new URL(url).hostname || 'el proyecto configurado';
  } catch {
    return 'el proyecto configurado';
  }
}

function fallar(mensaje: string, detalle?: string): never {
  console.error(`\n${mensaje}`);
  if (detalle) console.error(`  ${detalle}`);
  console.error('');
  process.exit(1);
}

/** La Admin API avisa de distintas formas que el correo ya está tomado. */
function esUsuarioDuplicado(error: { code?: string; status?: number; message: string }): boolean {
  const codigo = String(error.code ?? '');
  const texto = error.message.toLowerCase();
  return (
    codigo === 'email_exists' ||
    codigo === 'user_already_exists' ||
    texto.includes('already been registered') ||
    texto.includes('already registered') ||
    texto.includes('already exists')
  );
}

async function leerPlanilla(): Promise<Planilla> {
  let crudo: string;
  try {
    crudo = await readFile(RUTA_PLANILLA, 'utf8');
  } catch {
    return fallar(
      'No encontré los datos de la planilla.',
      `Tiene que estar en ${RUTA_PLANILLA}`,
    );
  }

  let planilla: Planilla;
  try {
    planilla = JSON.parse(crudo) as Planilla;
  } catch (e) {
    return fallar(
      'El archivo supabase/datos-planilla.json no es un JSON válido.',
      e instanceof Error ? e.message : String(e),
    );
  }

  if (
    !Array.isArray(planilla.profesores) ||
    !Array.isArray(planilla.lugares) ||
    !Array.isArray(planilla.registros)
  ) {
    return fallar(
      'supabase/datos-planilla.json no tiene la forma esperada.',
      'Se esperaban las listas profesores, lugares y registros.',
    );
  }

  return planilla;
}

// ---------------------------------------------------------------------------
// Pasos de la carga
// ---------------------------------------------------------------------------

/** Devuelve el mapa nombre normalizado -> código, para resolver los registros. */
async function sembrarEstados(supabase: ClienteAdmin): Promise<Map<string, string>> {
  console.log('Estados de clase');

  const { data, error } = await supabase.from('estados_clase').select('codigo');
  if (error) fallar('No pude leer los estados de clase.', error.message);

  const existentes = new Set(((data ?? []) as { codigo: string }[]).map((f) => f.codigo));
  const faltantes = ESTADOS.filter((e) => !existentes.has(e.codigo));

  if (faltantes.length > 0) {
    const { error: errorAlta } = await supabase
      .from('estados_clase')
      .upsert(faltantes, { onConflict: 'codigo', ignoreDuplicates: true });
    if (errorAlta) fallar('No pude dar de alta los estados de clase.', errorAlta.message);
  }

  for (const estado of ESTADOS) {
    if (existentes.has(estado.codigo)) {
      cuentas.estados.existentes += 1;
      console.log(`${marca('ya estaba')}${estado.codigo} — ${estado.nombre}`);
    } else {
      cuentas.estados.creados += 1;
      console.log(`${marca('creado')}${estado.codigo} — ${estado.nombre}`);
    }
  }

  return new Map(ESTADOS.map((e) => [normalizar(e.nombre), e.codigo]));
}

/** Devuelve el mapa nombre normalizado -> id, para resolver los registros. */
async function sembrarLugares(
  supabase: ClienteAdmin,
  planilla: Planilla,
): Promise<Map<string, number>> {
  console.log('\nLugares');

  const { data, error } = await supabase.from('lugares').select('id, nombre');
  if (error) fallar('No pude leer los lugares.', error.message);

  const guardados = (data ?? []) as { id: number; nombre: string }[];
  const porNombre = new Map(guardados.map((l) => [normalizar(l.nombre), l.id]));

  // El orden de la planilla ya viene por cantidad de registros históricos: el
  // lugar más usado queda primero en el desplegable del formulario de carga.
  const faltantes = planilla.lugares
    .map((lugar, indice) => ({ nombre: lugar.nombre.trim(), orden: indice + 1 }))
    .filter((lugar) => !porNombre.has(normalizar(lugar.nombre)));

  if (faltantes.length > 0) {
    const { error: errorAlta } = await supabase
      .from('lugares')
      .upsert(faltantes, { onConflict: 'nombre', ignoreDuplicates: true });
    if (errorAlta) fallar('No pude dar de alta los lugares.', errorAlta.message);

    const { data: recargados, error: errorRecarga } = await supabase
      .from('lugares')
      .select('id, nombre');
    if (errorRecarga) fallar('No pude releer los lugares recién creados.', errorRecarga.message);

    for (const lugar of (recargados ?? []) as { id: number; nombre: string }[]) {
      porNombre.set(normalizar(lugar.nombre), lugar.id);
    }
  }

  const nuevos = new Set(faltantes.map((l) => normalizar(l.nombre)));
  for (const lugar of planilla.lugares) {
    const clave = normalizar(lugar.nombre);
    if (nuevos.has(clave)) {
      cuentas.lugares.creados += 1;
      console.log(`${marca('creado')}${lugar.nombre}`);
    } else {
      cuentas.lugares.existentes += 1;
      console.log(`${marca('ya estaba')}${lugar.nombre}`);
    }
  }

  return porNombre;
}

/** Correos ya dados de alta en Supabase Auth. */
async function correosExistentes(supabase: ClienteAdmin): Promise<Set<string>> {
  const correos = new Set<string>();
  const porPagina = 200;

  for (let pagina = 1; pagina <= 50; pagina += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page: pagina,
      perPage: porPagina,
    });
    if (error) fallar('No pude leer los usuarios existentes.', error.message);

    for (const usuario of data.users) {
      if (usuario.email) correos.add(correo(usuario.email));
    }
    if (data.users.length < porPagina) break;
  }

  return correos;
}

async function sembrarUsuarios(supabase: ClienteAdmin, planilla: Planilla): Promise<void> {
  console.log('\nUsuarios');

  const { PASSWORD_INICIAL } = exigirVariables(['PASSWORD_INICIAL'] as const);

  // El coordinador administra el programa, así que entra con rol admin; el
  // resto del listado de la planilla son profesores que dictan clases (REQ 2).
  const usuarios: UsuarioSemilla[] = planilla.profesores.map((profesor) => ({
    nombre: profesor.nombre.trim(),
    cargo: profesor.cargo.trim(),
    email: correo(profesor.email),
    rol: normalizar(profesor.cargo) === 'coordinador' ? 'admin' : 'profesor',
    dicta_clases: true,
  }));
  usuarios.push(USUARIO_INSTITUCIONAL);

  const yaCreados = await correosExistentes(supabase);

  for (const usuario of usuarios) {
    if (yaCreados.has(usuario.email)) {
      cuentas.usuarios.existentes += 1;
      console.log(`${marca('ya estaba')}${usuario.nombre} — ${usuario.email}`);
      continue;
    }

    const { error } = await supabase.auth.admin.createUser({
      email: usuario.email,
      password: PASSWORD_INICIAL,
      email_confirm: true,
      user_metadata: {
        nombre: usuario.nombre,
        cargo: usuario.cargo,
        rol: usuario.rol,
        dicta_clases: usuario.dicta_clases,
        // El primer ingreso obliga a cambiarla: la contraseña inicial es
        // compartida y no puede quedar como definitiva.
        debe_cambiar_password: true,
      },
    });

    if (error && esUsuarioDuplicado(error)) {
      cuentas.usuarios.existentes += 1;
      console.log(`${marca('ya estaba')}${usuario.nombre} — ${usuario.email}`);
      continue;
    }

    if (error) {
      cuentas.usuarios.fallidos += 1;
      console.log(`${marca('falló')}${usuario.nombre} — ${usuario.email}: ${error.message}`);
      continue;
    }

    cuentas.usuarios.creados += 1;
    const etiquetaRol = usuario.rol === 'admin' ? 'admin' : 'profesor';
    console.log(`${marca('creado')}${usuario.nombre} — ${usuario.email} (${etiquetaRol})`);
  }
}

/** Mapa correo -> perfil, que es lo que los registros necesitan (REQ 2). */
async function perfilesPorCorreo(
  supabase: ClienteAdmin,
): Promise<Map<string, { id: string; nombre: string }>> {
  const { data, error } = await supabase.from('perfiles').select('id, nombre, email');
  if (error) fallar('No pude leer los perfiles.', error.message);

  const filas = (data ?? []) as { id: string; nombre: string; email: string }[];
  return new Map(filas.map((p) => [correo(p.email), { id: p.id, nombre: p.nombre }]));
}

/**
 * Claves fecha|profesor|lugar de lo ya importado, que es lo que hace idempotente
 * la carga. Va paginado porque PostgREST corta el resultado en 1000 filas.
 */
async function clavesYaImportadas(supabase: ClienteAdmin): Promise<Set<string>> {
  const claves = new Set<string>();
  const tamanio = 1000;

  for (let pagina = 0; pagina < 100; pagina += 1) {
    const desde = pagina * tamanio;
    const { data, error } = await supabase
      .from('registros')
      .select('fecha, profesor_id, lugar_id')
      .eq('origen', 'importacion')
      .range(desde, desde + tamanio - 1);
    if (error) fallar('No pude leer los registros ya importados.', error.message);

    const filas = (data ?? []) as { fecha: string; profesor_id: string; lugar_id: number }[];
    for (const fila of filas) claves.add(`${fila.fecha}|${fila.profesor_id}|${fila.lugar_id}`);
    if (filas.length < tamanio) break;
  }

  return claves;
}

async function sembrarRegistros(
  supabase: ClienteAdmin,
  planilla: Planilla,
  lugares: Map<string, number>,
  estados: Map<string, string>,
): Promise<void> {
  console.log('\nRegistros históricos');

  const perfiles = await perfilesPorCorreo(supabase);

  // Correo declarado en la planilla para cada etiqueta del desplegable. Sirve
  // para avisar cuando el registro quedó a nombre de otra persona.
  const correoDeEtiqueta = new Map(
    planilla.profesores.map((p) => [p.etiqueta.trim(), correo(p.email)]),
  );

  const importados = await clavesYaImportadas(supabase);

  for (const fila of planilla.registros) {
    const etiqueta = `${fechaLegible(fila.fecha)} · ${fila.lugar}`;
    const email = correo(fila.email_responsable);

    // REQ 4: si los números no cierran, el dato no entra. Importar en silencio
    // una inconsistencia es peor que dejarla afuera y avisarla.
    const suma = fila.varones + fila.mujeres;
    if (suma !== fila.alumnos_total) {
      cuentas.registros.omitidos += 1;
      console.log(
        `${marca('omitido')}${etiqueta} — varones (${fila.varones}) + mujeres ` +
        `(${fila.mujeres}) = ${suma}, pero el total declarado es ${fila.alumnos_total}.`,
      );
      continue;
    }

    if (fila.alumnos_nuevos > fila.alumnos_total) {
      cuentas.registros.omitidos += 1;
      console.log(
        `${marca('omitido')}${etiqueta} — los alumnos nuevos (${fila.alumnos_nuevos}) ` +
        `superan el total de alumnos (${fila.alumnos_total}).`,
      );
      continue;
    }

    // Quien envió el formulario, segun el correo que capturo Google.
    const quienCargo = perfiles.get(email);
    if (!quienCargo) {
      cuentas.registros.omitidos += 1;
      console.log(
        `${marca('omitido')}${etiqueta} — no hay ningún profesor con el correo ${email}.`,
      );
      continue;
    }

    // Quien dicto la clase, segun lo que la persona eligio en el desplegable.
    //
    // No son siempre el mismo: hay cargas hechas desde la cuenta de un colega.
    // La planilla vieja tenia una sola columna y obligaba a elegir uno de los
    // dos; el esquema nuevo tiene profesor_id y cargado_por separados, asi que
    // se conservan los dos hechos en vez de descartar uno.
    const correoDictante = correoDeEtiqueta.get(fila.profesor.trim());
    const perfil = (correoDictante && perfiles.get(correoDictante)) || quienCargo;

    const lugarId = lugares.get(normalizar(fila.lugar));
    if (!lugarId) {
      cuentas.registros.omitidos += 1;
      console.log(`${marca('omitido')}${etiqueta} — el lugar «${fila.lugar}» no está definido.`);
      continue;
    }

    const estadoCodigo = estados.get(normalizar(fila.estado_clase));
    if (!estadoCodigo) {
      cuentas.registros.omitidos += 1;
      console.log(
        `${marca('omitido')}${etiqueta} — el estado «${fila.estado_clase}» no está definido.`,
      );
      continue;
    }

    const clave = `${fila.fecha}|${perfil.id}|${lugarId}`;
    if (importados.has(clave)) {
      cuentas.registros.existentes += 1;
      console.log(`${marca('ya estaba')}${etiqueta} — ${perfil.nombre}`);
      continue;
    }

    if (perfil.id !== quienCargo.id) {
      console.log(
        `${marca('aviso')}${etiqueta} — la clase queda a nombre de ${perfil.nombre} ` +
        `(lo que dice la planilla) y la carga, a nombre de ${quienCargo.nombre} (${email}).`,
      );
    } else if (!correoDictante) {
      console.log(
        `${marca('aviso')}${etiqueta} — «${fila.profesor}» no figura en el listado de ` +
        `profesores; se usa el titular del correo, ${quienCargo.nombre}.`,
      );
    }

    const { error: errorAlta } = await supabase.from('registros').insert({
      fecha: fila.fecha,
      profesor_id: perfil.id,
      lugar_id: lugarId,
      estado_codigo: estadoCodigo,
      alumnos_total: fila.alumnos_total,
      alumnos_nuevos: fila.alumnos_nuevos,
      varones: fila.varones,
      mujeres: fila.mujeres,
      observaciones: (fila.observaciones ?? '').trim(),
      email_responsable: email,
      cargado_por: quienCargo.id,
      origen: 'importacion',
    });

    if (errorAlta) {
      cuentas.registros.fallidos += 1;
      console.log(`${marca('falló')}${etiqueta} — ${errorAlta.message}`);
      continue;
    }

    cuentas.registros.creados += 1;
    console.log(`${marca('importado')}${etiqueta} — ${perfil.nombre}`);
  }
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

function resumir(): void {
  const n = (valor: number) => String(valor).padStart(3);

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('Resumen de la carga inicial\n');
  console.log(
    `  Estados de clase  ${n(cuentas.estados.creados)} creados` +
    ` · ${cuentas.estados.existentes} ya estaban`,
  );
  console.log(
    `  Lugares           ${n(cuentas.lugares.creados)} creados` +
    ` · ${cuentas.lugares.existentes} ya estaban`,
  );
  console.log(
    `  Usuarios          ${n(cuentas.usuarios.creados)} creados` +
    ` · ${cuentas.usuarios.existentes} ya estaban` +
    (cuentas.usuarios.fallidos > 0 ? ` · ${cuentas.usuarios.fallidos} con error` : ''),
  );
  console.log(
    `  Registros         ${n(cuentas.registros.creados)} importados` +
    ` · ${cuentas.registros.existentes} ya estaban` +
    ` · ${cuentas.registros.omitidos} omitidos por datos incoherentes` +
    (cuentas.registros.fallidos > 0 ? ` · ${cuentas.registros.fallidos} con error` : ''),
  );

  if (cuentas.registros.omitidos > 0) {
    console.log(
      '\nLos registros omitidos figuran más arriba con el motivo al lado: casi siempre\n' +
      'son números que no cierran. Corregilos en la planilla y volvé a correr la carga,\n' +
      'que no duplica lo que ya está importado.',
    );
  }

  if (cuentas.usuarios.creados > 0) {
    console.log(
      '\nLas cuentas nuevas quedaron con la contraseña que cargaste en PASSWORD_INICIAL\n' +
      '(.env.local). El sistema les va a pedir cambiarla en el primer ingreso.',
    );
  }

  console.log('');

  // Un dato incoherente es un resultado esperado y avisado; un error contra la
  // base, no: ese tiene que notarse en el codigo de salida.
  if (cuentas.usuarios.fallidos > 0 || cuentas.registros.fallidos > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Programa
// ---------------------------------------------------------------------------

async function principal(): Promise<void> {
  const { NEXT_PUBLIC_SUPABASE_URL } = exigirVariables([
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PASSWORD_INICIAL',
  ] as const);

  const planilla = await leerPlanilla();

  const { clienteAdministrador } = (await import(RUTA_ADMINISTRADOR)) as ModuloAdministrador;
  const supabase = clienteAdministrador();

  console.log('\nCiudad Activa — carga inicial');
  console.log(`Proyecto: ${servidorDe(NEXT_PUBLIC_SUPABASE_URL)}`);
  console.log('Origen de los datos: Asistencia Ciudad Activa.xlsx\n');

  const estados = await sembrarEstados(supabase);
  const lugares = await sembrarLugares(supabase, planilla);
  await sembrarUsuarios(supabase, planilla);
  await sembrarRegistros(supabase, planilla, lugares, estados);

  resumir();
}

try {
  await principal();
} catch (e) {
  console.error('\nSe cortó la carga inicial por un error inesperado.');
  console.error(`  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
