'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Trae datos de la API y expone el estado de carga.
 *
 * El estado de carga se DEDUCE comparando la clave del pedido con la del
 * resultado guardado, en vez de asignarlo dentro del efecto. Llamar a
 * setState de forma sincrona en un efecto dispara un render extra en cascada
 * cada vez que cambia un filtro, y el panel vuelve a pedir en cada cambio.
 *
 * `clave` identifica el pedido: cuando cambia, lo guardado pasa a ser viejo y
 * `cargando` se vuelve true solo.
 */
export function useRecurso<T>(clave: string, traer: () => Promise<T>) {
  const [resultado, setResultado] = useState<{ clave: string; datos: T } | null>(null);
  const [error, setError] = useState<{ clave: string; mensaje: string } | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    // Evita que una respuesta lenta de un filtro anterior pise a la actual.
    let vigente = true;

    traer()
      .then((datos) => { if (vigente) setResultado({ clave, datos }); })
      .catch(() => {
        if (vigente) setError({ clave, mensaje: 'No se pudieron cargar los datos.' });
      });

    return () => { vigente = false; };
    // traer se recrea en cada render de quien llama; la clave es lo que manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, recarga]);

  const alDia = resultado?.clave === clave ? resultado.datos : null;
  const falla = error?.clave === clave ? error.mensaje : null;

  return {
    datos: alDia,
    error: falla,
    cargando: alDia === null && falla === null,
    /** Vuelve a pedir lo mismo, por ejemplo despues de guardar. */
    refrescar: useCallback(() => setRecarga((n) => n + 1), []),
  };
}

/** Pide JSON a la API y falla si la respuesta no es correcta. */
export async function traerJSON<T>(ruta: string): Promise<T> {
  const r = await fetch(ruta);
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}
