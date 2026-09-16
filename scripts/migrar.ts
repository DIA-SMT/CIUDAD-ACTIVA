// Aplica las migraciones SQL de supabase/migrations/ contra la base del proyecto.
//
// Se corre con "npm run db:migrar". Node ejecuta el TypeScript directo
// (--experimental-strip-types), asi que aca no entra nada de Next: solo modulos
// de node: y dependencias ya instaladas.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Tipos de pg
//
// pg no publica declaraciones propias, no hay @types/pg instalado y el proyecto
// no agrega dependencias, asi que se describe aca la porcion de la API que usa
// este script. Por lo mismo el nombre del paquete viaja en una constante: con
// un import literal, "npm run typecheck" fallaria por falta de declaraciones.
// ---------------------------------------------------------------------------

const PAQUETE_PG = 'pg';

interface ResultadoConsulta<F> {
  rows: F[];
}

interface ClientePg {
  connect(): Promise<void>;
  query<F extends object = Record<string, unknown>>(
    texto: string,
    valores?: unknown[],
  ): Promise<ResultadoConsulta<F>>;
  end(): Promise<void>;
}

interface ConfiguracionPg {
  connectionString: string;
  ssl: { rejectUnauthorized: boolean };
}

interface ModuloPg {
  Client: new (configuracion: ConfiguracionPg) => ClientePg;
}

/** Los campos del error de Postgres que vale la pena mostrarle a quien migra. */
interface DetallePostgres {
  message: string;
  code?: string;
  detail?: string;
  hint?: string;
  position?: string;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const CARPETA_MIGRACIONES = fileURLToPath(
  new URL('../supabase/migrations/', import.meta.url),
);

const ORIGEN_VARIABLES: Record<string, string> = {
  DATABASE_URL:
    'Project Settings > Database > Connection string > URI ' +
    '(acordate de reemplazar [YOUR-PASSWORD] por la contraseña de la base)',
};

/** Libro de migraciones aplicadas. Es lo que evita reaplicar un archivo. */
const SQL_TABLA_MIGRACIONES = `
  create table if not exists public.migraciones (
    nombre      text primary key,
    aplicada_en timestamptz not null default now()
  );
`;

// Codigos de "el objeto ya existe": casi siempre significan que la migracion se
// aplico a mano antes de que existiera el libro de migraciones.
const CODIGOS_YA_EXISTE = new Set(['42P07', '42710', '42723', '42P06']);

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

/** Solo el host de la cadena de conexión: nunca el usuario ni la contraseña. */
function servidorDe(cadena: string): string {
  try {
    return new URL(cadena).hostname || 'la base configurada';
  } catch {
    return 'la base configurada';
  }
}

function detalleDePostgres(e: unknown): DetallePostgres {
  if (typeof e === 'object' && e !== null) {
    const bruto = e as Partial<DetallePostgres>;
    return {
      message: bruto.message ?? String(e),
      code: bruto.code,
      detail: bruto.detail,
      hint: bruto.hint,
      position: bruto.position,
    };
  }
  return { message: String(e) };
}

function cuenta(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

async function migracionesDisponibles(): Promise<string[]> {
  try {
    const nombres = await readdir(CARPETA_MIGRACIONES);
    return nombres
      .filter((nombre) => nombre.toLowerCase().endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, 'en'));
  } catch {
    console.error(`\nNo encontré la carpeta de migraciones:\n  ${CARPETA_MIGRACIONES}\n`);
    process.exit(1);
  }
}

function informarFallo(archivo: string, e: unknown): void {
  const detalle = detalleDePostgres(e);

  console.error(`  falló       ${archivo}`);
  console.error(
    '\nLa migración se revirtió entera: la base quedó como estaba antes de este archivo.\n',
  );
  console.error(`  Postgres${detalle.code ? ` [${detalle.code}]` : ''}: ${detalle.message}`);
  if (detalle.detail) console.error(`  Detalle: ${detalle.detail}`);
  if (detalle.hint) console.error(`  Sugerencia de Postgres: ${detalle.hint}`);
  if (detalle.position) console.error(`  Posición en el archivo: carácter ${detalle.position}`);

  if (CODIGOS_YA_EXISTE.has(detalle.code ?? '')) {
    console.error(
      '\n  Algo de este archivo ya existía en la base. Si esta migración la habías\n' +
      '  aplicado a mano, dejala asentada para que el script la saltee:\n' +
      `    insert into public.migraciones (nombre) values ('${archivo}');`,
    );
  }

  console.error('');
}

// ---------------------------------------------------------------------------
// Programa
// ---------------------------------------------------------------------------

async function principal(): Promise<void> {
  const { DATABASE_URL } = exigirVariables(['DATABASE_URL'] as const);
  const archivos = await migracionesDisponibles();

  console.log('\nCiudad Activa — migraciones');
  console.log(`Base: ${servidorDe(DATABASE_URL)}\n`);

  if (archivos.length === 0) {
    console.log('No hay archivos .sql en supabase/migrations/. No hay nada que aplicar.\n');
    return;
  }

  const { Client } = (await import(PAQUETE_PG)) as ModuloPg;
  const cliente = new Client({
    connectionString: DATABASE_URL,
    // Supabase termina la conexión con un certificado de una CA que Node no
    // trae en su almacén; sin esto la conexión se cae antes de empezar.
    ssl: { rejectUnauthorized: false },
  });

  try {
    await cliente.connect();
  } catch (e) {
    console.error('No pude conectarme a la base.');
    console.error(`  ${detalleDePostgres(e).message}`);
    console.error(
      `\nRevisá DATABASE_URL en .env.local: la sacás de ${ORIGEN_VARIABLES.DATABASE_URL}.\n`,
    );
    process.exit(1);
  }

  let aplicadas = 0;
  let salteadas = 0;

  try {
    await cliente.query(SQL_TABLA_MIGRACIONES);
    try {
      // Sin políticas: el libro de migraciones no tiene por qué verse desde la
      // API pública. Si la conexión no es dueña de la tabla, seguimos igual.
      await cliente.query('alter table public.migraciones enable row level security');
    } catch {
      // No es motivo para frenar la migración.
    }

    const { rows } = await cliente.query<{ nombre: string }>(
      'select nombre from public.migraciones',
    );
    const yaAplicadas = new Set(rows.map((fila) => fila.nombre));

    for (const archivo of archivos) {
      if (yaAplicadas.has(archivo)) {
        salteadas += 1;
        console.log(`  ya estaba   ${archivo}`);
        continue;
      }

      const sql = await readFile(join(CARPETA_MIGRACIONES, archivo), 'utf8');

      // Cada archivo en su propia transacción: si falla en la mitad, no deja la
      // base con medio esquema creado.
      try {
        await cliente.query('begin');
        await cliente.query(sql);
        await cliente.query('insert into public.migraciones (nombre) values ($1)', [archivo]);
        await cliente.query('commit');
      } catch (e) {
        await cliente.query('rollback').catch(() => undefined);
        informarFallo(archivo, e);
        await cliente.end().catch(() => undefined);
        process.exit(1);
      }

      aplicadas += 1;
      console.log(`  aplicada    ${archivo}`);
    }
  } finally {
    await cliente.end().catch(() => undefined);
  }

  const resumen = `${cuenta(aplicadas, 'migración aplicada', 'migraciones aplicadas')}, ` +
    `${cuenta(salteadas, 'ya estaba', 'ya estaban')}.`;

  console.log(`\nListo: ${resumen}`);
  if (aplicadas > 0) {
    console.log('Ahora podés correr la carga inicial con "npm run db:sembrar".\n');
  } else {
    console.log('La base ya estaba al día.\n');
  }
}

try {
  await principal();
} catch (e) {
  // Red de contención: cualquier cosa que no sea un fallo de una migración
  // concreta (las de arriba ya se informan con su archivo y su código).
  console.error('\nSe cortó la migración por un error inesperado.');
  console.error(`  ${detalleDePostgres(e).message}\n`);
  process.exit(1);
}
