-- ============================================================================
--  Ciudad Activa - Esquema de base de datos
--  Direccion de Deportes y Recreacion | Municipalidad de San Miguel de Tucuman
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- REQ 2: listado de profesores autorizados. Los registros referencian a esta
-- tabla por id, de modo que el nombre nunca se escribe a mano.
-- Un usuario puede dictar clases, administrar, o ambas cosas.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre                 TEXT    NOT NULL,
  cargo                  TEXT    NOT NULL DEFAULT 'Profesor',
  email                  TEXT    NOT NULL UNIQUE,
  usuario                TEXT    NOT NULL UNIQUE,
  password_hash          TEXT    NOT NULL,
  rol                    TEXT    NOT NULL DEFAULT 'profesor'
                                 CHECK (rol IN ('profesor', 'admin')),
  -- 1 = aparece en el listado de profesores autorizados del formulario
  dicta_clases           INTEGER NOT NULL DEFAULT 1 CHECK (dicta_clases IN (0, 1)),
  activo                 INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  debe_cambiar_password  INTEGER NOT NULL DEFAULT 1 CHECK (debe_cambiar_password IN (0, 1)),
  creado_en              TEXT    NOT NULL,
  actualizado_en         TEXT    NOT NULL,
  ultimo_acceso          TEXT
);

CREATE INDEX IF NOT EXISTS ix_usuarios_activo ON usuarios (activo, dicta_clases);

-- ---------------------------------------------------------------------------
-- REQ 3: espacios de actividad previamente definidos.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lugares (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre         TEXT    NOT NULL UNIQUE,
  descripcion    TEXT    NOT NULL DEFAULT '',
  activo         INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  orden          INTEGER NOT NULL DEFAULT 0,
  creado_en      TEXT    NOT NULL,
  actualizado_en TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_lugares_activo ON lugares (activo, orden);

-- ---------------------------------------------------------------------------
-- Estado de la clase. es_suspension habilita los indicadores del REQ 7
-- (cantidad y porcentaje de clases suspendidas, motivos de suspension).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estados_clase (
  codigo        TEXT    PRIMARY KEY,
  nombre        TEXT    NOT NULL UNIQUE,
  es_suspension INTEGER NOT NULL DEFAULT 0 CHECK (es_suspension IN (0, 1)),
  activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  orden         INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- REQ 1: registro individual de cada actividad/clase.
-- REQ 4: la validacion varones + mujeres = total se exige tambien en la base,
--        no solo en el formulario, para que ningun camino la pueda saltear.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registros (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha              TEXT    NOT NULL,
  profesor_id        INTEGER NOT NULL REFERENCES usuarios(id)          ON DELETE RESTRICT,
  lugar_id           INTEGER NOT NULL REFERENCES lugares(id)           ON DELETE RESTRICT,
  estado_codigo      TEXT    NOT NULL REFERENCES estados_clase(codigo) ON DELETE RESTRICT,
  alumnos_total      INTEGER NOT NULL DEFAULT 0,
  alumnos_nuevos     INTEGER NOT NULL DEFAULT 0,
  varones            INTEGER NOT NULL DEFAULT 0,
  mujeres            INTEGER NOT NULL DEFAULT 0,
  observaciones      TEXT    NOT NULL DEFAULT '',
  email_responsable  TEXT    NOT NULL,
  cargado_por        INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  origen             TEXT    NOT NULL DEFAULT 'web'
                             CHECK (origen IN ('web', 'importacion')),
  creado_en          TEXT    NOT NULL,
  actualizado_en     TEXT    NOT NULL,

  CONSTRAINT ck_fecha_formato   CHECK (fecha LIKE '____-__-__'),
  CONSTRAINT ck_no_negativos    CHECK (alumnos_total  >= 0 AND alumnos_nuevos >= 0
                                   AND varones        >= 0 AND mujeres        >= 0),
  -- REQ 4
  CONSTRAINT ck_suma_sexos      CHECK (varones + mujeres = alumnos_total),
  CONSTRAINT ck_nuevos_en_total CHECK (alumnos_nuevos <= alumnos_total)
);

-- REQ 5 y REQ 8: consulta e indices por fecha, profesor y lugar.
CREATE INDEX IF NOT EXISTS ix_registros_fecha    ON registros (fecha DESC);
CREATE INDEX IF NOT EXISTS ix_registros_profesor ON registros (profesor_id, fecha DESC);
CREATE INDEX IF NOT EXISTS ix_registros_lugar    ON registros (lugar_id, fecha DESC);
CREATE INDEX IF NOT EXISTS ix_registros_estado   ON registros (estado_codigo, fecha DESC);
-- No es UNIQUE a proposito: en los datos historicos existen dias con dos clases
-- del mismo profesor en el mismo lugar. El duplicado se avisa, no se bloquea.
CREATE INDEX IF NOT EXISTS ix_registros_dup      ON registros (fecha, profesor_id, lugar_id);

-- ---------------------------------------------------------------------------
-- REQ 6: historial de modificaciones. Una fila por campo modificado.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registros_historial (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  registro_id    INTEGER NOT NULL,
  accion         TEXT    NOT NULL CHECK (accion IN ('creacion', 'modificacion', 'eliminacion')),
  campo          TEXT    NOT NULL DEFAULT '',
  valor_anterior TEXT    NOT NULL DEFAULT '',
  valor_nuevo    TEXT    NOT NULL DEFAULT '',
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nombre TEXT    NOT NULL DEFAULT '',
  fecha_hora     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_historial_registro ON registros_historial (registro_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_historial_fecha    ON registros_historial (fecha_hora DESC);

-- ---------------------------------------------------------------------------
-- Sesiones de usuario (login con usuario y contrasena).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sesiones (
  id         TEXT    PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creada_en  TEXT    NOT NULL,
  expira_en  TEXT    NOT NULL,
  ip         TEXT    NOT NULL DEFAULT '',
  user_agent TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS ix_sesiones_usuario ON sesiones (usuario_id);
CREATE INDEX IF NOT EXISTS ix_sesiones_expira  ON sesiones (expira_en);

-- ---------------------------------------------------------------------------
-- Vista de consulta: resuelve los nombres de profesor, lugar y estado.
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_registros AS
SELECT
  r.id, r.fecha,
  r.profesor_id, u.nombre AS profesor_nombre, u.cargo AS profesor_cargo,
  r.lugar_id,    l.nombre AS lugar_nombre,
  r.estado_codigo, e.nombre AS estado_nombre, e.es_suspension,
  r.alumnos_total, r.alumnos_nuevos, r.varones, r.mujeres,
  r.observaciones, r.email_responsable, r.origen,
  r.cargado_por, c.nombre AS cargado_por_nombre,
  r.creado_en, r.actualizado_en,
  CAST(strftime('%Y', r.fecha) AS INTEGER) AS anio,
  CAST(strftime('%m', r.fecha) AS INTEGER) AS mes,
  strftime('%Y-%m', r.fecha)               AS periodo
FROM registros r
JOIN usuarios       u ON u.id = r.profesor_id
JOIN lugares        l ON l.id = r.lugar_id
JOIN estados_clase  e ON e.codigo = r.estado_codigo
LEFT JOIN usuarios  c ON c.id = r.cargado_por;
