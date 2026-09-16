import type { ReactNode } from 'react';

/**
 * Render del subconjunto de markdown que usa el asistente: párrafos, listas,
 * tablas, negrita y código.
 *
 * Se escribe a mano en vez de sumar una librería porque el texto viene de un
 * modelo y termina como HTML: acá nada se interpola crudo, todo pasa por React,
 * que escapa solo. Una librería de markdown con `dangerouslySetInnerHTML`
 * abriría una vía de inyección por el contenido de las observaciones.
 */

/** Negrita, cursiva y código dentro de una línea. */
function enLinea(texto: string, clave: string): ReactNode[] {
  const partes: ReactNode[] = [];
  const patron = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let ultimo = 0;
  let i = 0;

  for (const m of texto.matchAll(patron)) {
    const inicio = m.index ?? 0;
    if (inicio > ultimo) partes.push(texto.slice(ultimo, inicio));
    const t = m[0];
    const k = `${clave}-${i++}`;

    if (t.startsWith('**')) {
      partes.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    } else if (t.startsWith('`')) {
      partes.push(
        <code key={k} className="bg-muted rounded px-1 py-0.5 text-[0.9em]">
          {t.slice(1, -1)}
        </code>,
      );
    } else {
      partes.push(<em key={k}>{t.slice(1, -1)}</em>);
    }
    ultimo = inicio + t.length;
  }

  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

const celdas = (fila: string) =>
  fila.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

const esSeparador = (fila: string) => /^\|?[\s:|-]+\|[\s:|-]*$/.test(fila.trim());

export function Markdown({ texto }: { texto: string }) {
  const lineas = texto.split('\n');
  const bloques: ReactNode[] = [];
  let i = 0;

  while (i < lineas.length) {
    const linea = lineas[i];

    if (!linea.trim()) { i += 1; continue; }

    // --- tabla ---
    if (linea.includes('|') && i + 1 < lineas.length && esSeparador(lineas[i + 1])) {
      const encabezado = celdas(linea);
      const filas: string[][] = [];
      i += 2;
      while (i < lineas.length && lineas[i].includes('|') && lineas[i].trim()) {
        filas.push(celdas(lineas[i]));
        i += 1;
      }
      bloques.push(
        <div key={`t-${i}`} className="my-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                {encabezado.map((c, n) => (
                  <th
                    key={n}
                    className={`px-2 py-1.5 font-medium ${n === 0 ? 'text-left' : 'text-right'}`}
                  >
                    {enLinea(c, `th-${n}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, f) => (
                <tr key={f} className="border-b last:border-0">
                  {fila.map((c, n) => (
                    <td
                      key={n}
                      className={`px-2 py-1.5 ${n === 0 ? '' : 'cifra text-right'}`}
                    >
                      {enLinea(c, `td-${f}-${n}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // --- lista ---
    if (/^\s*[-*]\s+/.test(linea) || /^\s*\d+\.\s+/.test(linea)) {
      const ordenada = /^\s*\d+\.\s+/.test(linea);
      const items: string[] = [];
      while (
        i < lineas.length &&
        (/^\s*[-*]\s+/.test(lineas[i]) || /^\s*\d+\.\s+/.test(lineas[i]))
      ) {
        items.push(lineas[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
        i += 1;
      }
      const Lista = ordenada ? 'ol' : 'ul';
      bloques.push(
        <Lista
          key={`l-${i}`}
          className={`my-2 space-y-1 pl-5 ${ordenada ? 'list-decimal' : 'list-disc'}`}
        >
          {items.map((t, n) => (
            <li key={n}>{enLinea(t, `li-${i}-${n}`)}</li>
          ))}
        </Lista>,
      );
      continue;
    }

    // --- título ---
    const titulo = linea.match(/^(#{1,4})\s+(.*)$/);
    if (titulo) {
      bloques.push(
        <p key={`h-${i}`} className="mt-3 mb-1 font-semibold">
          {enLinea(titulo[2], `h-${i}`)}
        </p>,
      );
      i += 1;
      continue;
    }

    // --- párrafo ---
    const parrafo: string[] = [];
    while (
      i < lineas.length &&
      lineas[i].trim() &&
      !lineas[i].includes('|') &&
      !/^\s*(?:[-*]|\d+\.)\s+/.test(lineas[i]) &&
      !/^#{1,4}\s/.test(lineas[i])
    ) {
      parrafo.push(lineas[i]);
      i += 1;
    }
    if (parrafo.length) {
      bloques.push(
        <p key={`p-${i}`} className="my-1.5 leading-relaxed">
          {enLinea(parrafo.join(' '), `p-${i}`)}
        </p>,
      );
    } else {
      i += 1;
    }
  }

  return <div className="text-sm">{bloques}</div>;
}
