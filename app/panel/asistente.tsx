'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Database, Loader2, Sparkles, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Markdown } from '@/lib/markdown';
import type { Perfil } from '@/lib/tipos';

interface Consulta {
  herramienta: string;
  detalle: string;
}

interface Mensaje {
  rol: 'usuario' | 'asistente';
  texto: string;
  consultas?: Consulta[];
}

const SUGERENCIAS = [
  '¿Cómo viene el programa este mes comparado con el anterior?',
  '¿Qué profesor dio más clases y cuántos alumnos tuvo?',
  '¿Qué espacios están más flojos de participación?',
  '¿Cuántas clases se suspendieron por lluvia y en qué plazas?',
];

const ETIQUETAS: Record<string, string> = {
  resumen: 'Indicadores generales',
  por_profesor: 'Actividad por profesor',
  por_lugar: 'Actividad por espacio',
  evolucion: 'Evolución en el tiempo',
  sexo: 'Distribución por sexo',
  suspensiones: 'Clases suspendidas',
  clases: 'Clases puntuales',
};

export function Asistente({ perfil }: { perfil: Perfil }) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [borrador, setBorrador] = useState('');
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fin = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensajes, pensando]);

  async function preguntar(texto: string) {
    const pregunta = texto.trim();
    if (!pregunta || pensando) return;

    const historia: Mensaje[] = [...mensajes, { rol: 'usuario', texto: pregunta }];
    setMensajes(historia);
    setBorrador('');
    setError(null);
    setPensando(true);

    try {
      const r = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensajes: historia.map((m) => ({ rol: m.rol, texto: m.texto })),
        }),
      });
      const d = await r.json().catch(() => null);

      if (!r.ok) {
        setError(d?.error ?? 'El asistente no pudo responder.');
        return;
      }
      setMensajes((m) => [
        ...m,
        { rol: 'asistente', texto: d.texto, consultas: d.consultas ?? [] },
      ]);
    } catch {
      setError('No se pudo conectar con el asistente.');
    } finally {
      setPensando(false);
      campo.current?.focus();
    }
  }

  return (
    <Card className="flex h-[70dvh] min-h-[28rem] flex-col gap-0 overflow-hidden py-0">
      {/* --- conversación --- */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {mensajes.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="bg-azul-50 text-azul-700 rounded-full p-3">
              <Sparkles className="h-6 w-6" aria-hidden />
            </div>
            <div className="max-w-md">
              <p className="font-medium">Preguntame lo que necesites del programa</p>
              <p className="text-muted-foreground mt-1 text-sm text-balance">
                Consulto los mismos indicadores que ves en el tablero, así que los números
                nunca van a contradecirlo. No estimo nada: si no puedo consultarlo, te lo digo.
              </p>
            </div>
            <div className="flex w-full max-w-lg flex-col gap-2">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void preguntar(s)}
                  className="hover:bg-muted focus-visible:ring-ring rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensajes.map((m, i) =>
          m.rol === 'usuario' ? (
            <div key={i} className="flex justify-end">
              <p className="bg-azul-700 max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm text-white">
                {m.texto}
              </p>
            </div>
          ) : (
            <div key={i} className="max-w-[92%]">
              <Markdown texto={m.texto} />
              {m.consultas && m.consultas.length > 0 && (
                <details className="text-muted-foreground mt-2 text-xs">
                  <summary className="hover:text-foreground inline-flex cursor-pointer items-center gap-1.5">
                    <Database className="h-3 w-3" aria-hidden />
                    De dónde salen estos números
                  </summary>
                  <ul className="mt-1.5 space-y-0.5 border-l pl-3">
                    {m.consultas.map((c, n) => (
                      <li key={n}>
                        {ETIQUETAS[c.herramienta] ?? c.herramienta} — {c.detalle}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ),
        )}

        {pensando && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Consultando los datos…
          </p>
        )}

        {error && (
          <p className="text-rojo-600 bg-rojo-600/5 rounded-lg px-3 py-2 text-sm">{error}</p>
        )}

        <div ref={fin} />
      </div>

      {/* --- barra de escritura --- */}
      <CardContent className="border-t p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void preguntar(borrador);
          }}
          className="flex items-end gap-2"
        >
          <Textarea
            ref={campo}
            value={borrador}
            onChange={(e) => setBorrador(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía; Shift+Enter hace un salto de línea.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void preguntar(borrador);
              }
            }}
            rows={1}
            placeholder={`Preguntá lo que quieras, ${perfil.nombre.split(' ')[0]}…`}
            className="max-h-32 min-h-11 flex-1 resize-none"
            aria-label="Tu pregunta"
            disabled={pensando}
          />
          {mensajes.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => { setMensajes([]); setError(null); }}
              disabled={pensando}
              aria-label="Empezar una conversación nueva"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          )}
          <Button type="submit" size="icon" disabled={pensando || !borrador.trim()} aria-label="Enviar">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </Button>
        </form>
        <p className="text-muted-foreground mt-2 text-[11px]">
          Las respuestas salen de consultar la base. Aun así, si un número va a un informe,
          verificalo en el tablero.
        </p>
      </CardContent>
    </Card>
  );
}
