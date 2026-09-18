// Tipos del dominio. Espejan las tablas de supabase/migrations/0001_esquema.sql.

export type Rol = 'profesor' | 'admin';
/** Estado de revisión de una carga. Sólo lo aprobado entra en los indicadores. */
export type Aprobacion = 'pendiente' | 'aprobado' | 'rechazado';
export type Origen = 'web' | 'importacion';
export type AccionHistorial = 'creacion' | 'modificacion' | 'eliminacion';
export type Agrupacion = 'dia' | 'semana' | 'mes';

export interface Perfil {
  id: string;
  nombre: string;
  cargo: string;
  email: string;
  rol: Rol;
  dicta_clases: boolean;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
}

/** Lo que el formulario necesita del listado de autorizados (REQ 2). */
export interface ProfesorOpcion {
  id: string;
  nombre: string;
  cargo: string;
  email: string;
}

export interface Lugar {
  id: number;
  nombre: string;
  descripcion: string;
  activo: boolean;
  orden: number;
}

export interface EstadoClase {
  codigo: string;
  nombre: string;
  es_suspension: boolean;
  activo: boolean;
  orden: number;
}

export interface Catalogos {
  profesores: ProfesorOpcion[];
  lugares: Pick<Lugar, 'id' | 'nombre'>[];
  estados: Pick<EstadoClase, 'codigo' | 'nombre' | 'es_suspension'>[];
}

/**
 * Fila de la vista v_registros.
 *
 * No trae el estado de aprobación: esa vista es la que consumen las funciones
 * de indicadores, que ya filtran por aprobado. Para ver o revisar el estado se
 * usa RegistroRevision, que sale de v_revision.
 */
export interface Registro {
  id: number;
  fecha: string;
  profesor_id: string;
  profesor_nombre: string;
  profesor_cargo: string;
  lugar_id: number;
  lugar_nombre: string;
  estado_codigo: string;
  estado_nombre: string;
  es_suspension: boolean;
  alumnos_total: number;
  alumnos_nuevos: number;
  varones: number;
  mujeres: number;
  observaciones: string;
  email_responsable: string;
  origen: Origen;
  cargado_por: string | null;
  cargado_por_nombre: string | null;
  creado_en: string;
  actualizado_en: string;
  anio: number;
  mes: number;
  periodo: string;
  semana: string;
}

/** Fila de v_revision: lo mismo más el estado de aprobación. */
export interface RegistroRevision extends Registro {
  aprobacion: Aprobacion;
  revisado_por: string | null;
  revisado_por_nombre: string | null;
  revisado_en: string | null;
  motivo_rechazo: string;
}

/** Lo que manda el formulario de carga. */
export interface CuerpoRegistro {
  fecha: string;
  profesor_id: string;
  lugar_id: number;
  estado_codigo: string;
  alumnos_total: number;
  alumnos_nuevos: number;
  varones: number;
  mujeres: number;
  observaciones: string;
  email_responsable: string;
  confirmar_duplicado?: boolean;
}

export interface EntradaHistorial {
  id: number;
  registro_id: number;
  accion: AccionHistorial;
  campo: string;
  etiqueta_campo: string;
  valor_anterior: string;
  valor_nuevo: string;
  usuario_id: string | null;
  usuario_nombre: string;
  fecha_hora: string;
}

/** Filtros del REQ 8. */
export interface Filtros {
  desde?: string;
  hasta?: string;
  profesor_id?: string;
  lugar_id?: number;
  estado?: string;
  q?: string;
  /**
   * Filtra el listado por estado de revisión. No viaja a las funciones de
   * indicadores: esas cuentan siempre y sólo lo aprobado.
   */
  aprobacion?: Aprobacion;
}

export interface Pagina<T> {
  datos: T[];
  total: number;
  pagina: number;
  por_pagina: number;
  paginas: number;
}

// --- REQ 7: indicadores -----------------------------------------------------

/** Lo que el tablero necesita saber de la cola de revisión. */
export interface EstadoRevision {
  pendientes: number;
}

export interface Resumen {
  clases_registradas: number;
  clases_realizadas: number;
  clases_suspendidas: number;
  porcentaje_suspendidas: number;
  alumnos_total: number;
  alumnos_nuevos: number;
  varones: number;
  mujeres: number;
  porcentaje_varones: number;
  porcentaje_mujeres: number;
  promedio_por_clase: number;
  profesores_activos: number;
  lugares_activos: number;
  primera_fecha: string | null;
  ultima_fecha: string | null;
}

export interface FilaProfesor {
  profesor_id: string;
  profesor: string;
  cargo: string;
  clases: number;
  alumnos: number;
  alumnos_nuevos: number;
  promedio: number;
  suspendidas: number;
}

export interface FilaLugar {
  lugar_id: number;
  lugar: string;
  clases: number;
  alumnos: number;
  alumnos_nuevos: number;
  promedio: number;
  suspendidas: number;
  ultima_clase: string | null;
}

export interface PuntoEvolucion {
  periodo: string;
  etiqueta: string;
  clases: number;
  alumnos: number;
  alumnos_nuevos: number;
  promedio: number;
}

export interface DistribucionSexo {
  varones: number;
  mujeres: number;
  porcentaje_varones: number;
  porcentaje_mujeres: number;
  por_periodo: { periodo: string; etiqueta: string; varones: number; mujeres: number }[];
}

export interface Suspensiones {
  total: number;
  porcentaje: number;
  por_motivo: { codigo: string; nombre: string; cantidad: number; porcentaje: number }[];
  por_lugar: { lugar: string; cantidad: number }[];
  detalle: {
    id: number; fecha: string; lugar: string; profesor: string;
    estado_nombre: string; observaciones: string;
  }[];
}

export interface Tablero {
  resumen: Resumen;
  por_profesor: FilaProfesor[];
  por_lugar: FilaLugar[];
  evolucion: PuntoEvolucion[];
  sexo: DistribucionSexo;
  suspensiones: Suspensiones;
}

/** Forma del error que devuelve la API. */
export interface ErrorAPI {
  error: string;
  errores?: Record<string, string>;
  duplicados?: Registro[];
}
