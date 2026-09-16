'use client';

import { useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmt } from '@/lib/fechas';
import { traerJSON, useRecurso } from '@/lib/usar-recurso';
import type { EntradaHistorial, Lugar, Pagina, Perfil } from '@/lib/tipos';

/** Lo que agrega /api/admin/usuarios sobre el perfil. */
type UsuarioAdmin = Perfil & { registros: number };

/** Se muestra una sola vez: despues no hay forma de recuperarla. */
function ClaveGenerada({
  clave, nombre, onCerrar,
}: {
  clave: string;
  nombre: string;
  onCerrar: () => void;
}) {
  const [copiada, setCopiada] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(clave);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      toast.error('No se pudo copiar. Anotala a mano.');
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contraseña de {nombre}</DialogTitle>
          <DialogDescription>
            Anotala o copiala ahora: no se vuelve a mostrar. Cuando {nombre} ingrese, el
            sistema le va a pedir que la cambie por una propia.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted flex items-center gap-3 rounded-lg border p-4">
          <code className="flex-1 font-mono text-lg tracking-wider select-all">{clave}</code>
          <Button variant="outline" size="sm" onClick={() => void copiar()}>
            {copiada ? (
              <Check className="text-verde-600 h-4 w-4" aria-hidden />
            ) : (
              <Copy className="h-4 w-4" aria-hidden />
            )}
            {copiada ? 'Copiada' : 'Copiar'}
          </Button>
        </div>

        <DialogFooter>
          <Button onClick={onCerrar}>Ya la anoté</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Profesores
// ---------------------------------------------------------------------------

const NUEVO = { nombre: '', cargo: 'Profesor', email: '', rol: 'profesor', dicta_clases: true };

function Profesores({ perfil }: { perfil: Perfil }) {
  const [alta, setAlta] = useState(false);
  const [datos, setDatos] = useState(NUEVO);
  const [guardando, setGuardando] = useState(false);
  const [clave, setClave] = useState<{ clave: string; nombre: string } | null>(null);

  const { datos: listado, refrescar: traer } = useRecurso(
    '/api/admin/usuarios',
    () => traerJSON<{ usuarios: UsuarioAdmin[] }>('/api/admin/usuarios'),
  );
  const usuarios = listado?.usuarios ?? null;

  async function crear() {
    setGuardando(true);
    const r = await fetch('/api/admin/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    const d = await r.json().catch(() => null);
    setGuardando(false);

    if (!r.ok) {
      toast.error(d?.error ?? 'No se pudo crear el usuario.');
      return;
    }
    setAlta(false);
    setDatos(NUEVO);
    if (d?.password) setClave({ clave: d.password, nombre: datos.nombre });
    else toast.success('Usuario creado');
    void traer();
  }

  async function cambiar(u: Perfil, cambios: Partial<Perfil>) {
    const r = await fetch(`/api/admin/usuarios/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      toast.error(d?.error ?? 'No se pudo guardar el cambio.');
      return;
    }
    toast.success('Cambio guardado');
    void traer();
  }

  async function resetear(u: Perfil) {
    const r = await fetch(`/api/admin/usuarios/${u.id}/password`, { method: 'POST' });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      toast.error(d?.error ?? 'No se pudo restablecer la contraseña.');
      return;
    }
    if (d?.password) setClave({ clave: d.password, nombre: u.nombre });
  }

  if (!usuarios) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setAlta(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          Agregar profesor
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Correo</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>En el formulario</TableHead>
              <TableHead className="text-right">Clases</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {usuarios.map((u) => {
              const yoMismo = u.id === perfil.id;
              return (
                <TableRow key={u.id} className={u.activo ? undefined : 'opacity-60'}>
                  <TableCell className="font-medium">{u.nombre}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>{u.cargo}</TableCell>
                  <TableCell>
                    <Badge variant={u.rol === 'admin' ? 'default' : 'secondary'}>
                      {u.rol === 'admin' ? 'Administrador' : 'Profesor'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={u.dicta_clases}
                      onCheckedChange={(v) => void cambiar(u, { dicta_clases: Boolean(v) })}
                      aria-label={`${u.nombre} aparece en el listado de profesores`}
                    />
                  </TableCell>
                  <TableCell className="cifra text-right">
                    {u.registros > 0 ? fmt.numero(u.registros) : '—'}
                  </TableCell>
                  <TableCell>
                    {u.activo ? (
                      <span className="text-verde-700 text-sm">Activo</span>
                    ) : (
                      <span className="text-muted-foreground text-sm">Inactivo</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void resetear(u)}
                        aria-label={`Restablecer la contraseña de ${u.nombre}`}
                      >
                        <KeyRound className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={yoMismo}
                        title={yoMismo ? 'No podés desactivarte a vos mismo' : undefined}
                        onClick={() => void cambiar(u, { activo: !u.activo })}
                      >
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={alta} onOpenChange={setAlta}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar profesor</DialogTitle>
            <DialogDescription>
              Se crea la cuenta con una contraseña generada, que vas a ver una sola vez.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="n-nombre">Nombre y apellido</Label>
              <Input
                id="n-nombre"
                value={datos.nombre}
                onChange={(e) => setDatos({ ...datos, nombre: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="n-email">Correo electrónico</Label>
              <Input
                id="n-email"
                type="email"
                value={datos.email}
                onChange={(e) => setDatos({ ...datos, email: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="n-cargo">Cargo</Label>
                <Select
                  value={datos.cargo}
                  onValueChange={(v) => setDatos({ ...datos, cargo: v ?? 'Profesor' })}
                >
                  <SelectTrigger id="n-cargo" className="w-full">
                    <SelectValue>{(v: string | null) => v ?? 'Profesor'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Profesor">Profesor</SelectItem>
                    <SelectItem value="Coordinador">Coordinador</SelectItem>
                    <SelectItem value="Administración">Administración</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="n-rol">Rol en el sistema</Label>
                <Select
                  value={datos.rol}
                  onValueChange={(v) => setDatos({ ...datos, rol: v ?? 'profesor' })}
                >
                  <SelectTrigger id="n-rol" className="w-full">
                    <SelectValue>
                      {(v: string | null) =>
                        v === 'admin' ? 'Administrador' : 'Profesor'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="profesor">Profesor</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={datos.dicta_clases}
                onCheckedChange={(v) => setDatos({ ...datos, dicta_clases: Boolean(v) })}
              />
              Aparece en el listado de profesores del formulario
            </label>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setAlta(false)}>Cancelar</Button>
            <Button
              onClick={() => void crear()}
              disabled={guardando || !datos.nombre.trim() || !datos.email.trim()}
            >
              {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Crear la cuenta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {clave && (
        <ClaveGenerada
          clave={clave.clave}
          nombre={clave.nombre}
          onCerrar={() => setClave(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Lugares
// ---------------------------------------------------------------------------

function Lugares() {
  const [nombre, setNombre] = useState('');
  const [guardando, setGuardando] = useState(false);

  const { datos: listado, refrescar: traer } = useRecurso(
    '/api/admin/lugares',
    () => traerJSON<{ lugares: Lugar[] }>('/api/admin/lugares'),
  );
  const lugares = listado?.lugares ?? null;

  async function crear() {
    if (!nombre.trim()) return;
    setGuardando(true);
    const r = await fetch('/api/admin/lugares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: nombre.trim(), descripcion: '', orden: 0 }),
    });
    const d = await r.json().catch(() => null);
    setGuardando(false);
    if (!r.ok) {
      toast.error(d?.error ?? 'No se pudo crear el lugar.');
      return;
    }
    toast.success('Lugar agregado');
    setNombre('');
    void traer();
  }

  async function alternar(l: Lugar) {
    const r = await fetch(`/api/admin/lugares/${l.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: !l.activo }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      toast.error(d?.error ?? 'No se pudo guardar el cambio.');
      return;
    }
    toast.success(
      l.activo ? 'Espacio desactivado' : 'Espacio activado',
      d?.aviso ? { description: d.aviso } : undefined,
    );
    void traer();
  }

  if (!lugares) return <Skeleton className="h-64 w-full" />;

  return (
    <>
      <div className="mb-3 flex gap-2">
        <Input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del espacio nuevo"
          onKeyDown={(e) => e.key === 'Enter' && void crear()}
          aria-label="Nombre del espacio nuevo"
        />
        <Button onClick={() => void crear()} disabled={guardando || !nombre.trim()}>
          {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Agregar
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Espacio</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lugares.map((l) => (
              <TableRow key={l.id} className={l.activo ? undefined : 'opacity-60'}>
                <TableCell className="font-medium">{l.nombre}</TableCell>
                <TableCell>
                  {l.activo ? (
                    <span className="text-verde-700 text-sm">Activo</span>
                  ) : (
                    <span className="text-muted-foreground text-sm">Inactivo</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => void alternar(l)}>
                    {l.activo ? 'Desactivar' : 'Activar'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground mt-2 text-xs text-balance">
        Los espacios no se eliminan: se desactivan. Dejan de ofrecerse en el formulario,
        pero las clases ya cargadas siguen contando en las estadísticas.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Auditoría
// ---------------------------------------------------------------------------

function Auditoria() {
  const [pagina, setPagina] = useState(1);

  const ruta = `/api/admin/historial?pagina=${pagina}&por_pagina=30`;
  const { datos, error } = useRecurso(ruta, () => traerJSON<Pagina<EntradaHistorial>>(ruta));

  if (error) {
    return <p className="text-rojo-600 py-8 text-center text-sm">
      No se pudo cargar la auditoría.
    </p>;
  }
  if (!datos) return <Skeleton className="h-64 w-full" />;

  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cuándo</TableHead>
              <TableHead>Quién</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Cambio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {datos.datos.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="cifra whitespace-nowrap">
                  {fmt.fechaHora(h.fecha_hora)}
                </TableCell>
                <TableCell>{h.usuario_nombre || '—'}</TableCell>
                <TableCell>
                  <Badge variant={h.accion === 'eliminacion' ? 'destructive' : 'secondary'}>
                    {h.accion}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {h.accion === 'modificacion' ? (
                    <>
                      <strong>{h.etiqueta_campo || h.campo}</strong>{' '}
                      <span className="text-muted-foreground line-through">
                        {h.valor_anterior || '—'}
                      </span>{' '}
                      → {h.valor_nuevo || '—'}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {h.valor_nuevo || h.valor_anterior || '—'}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {datos.paginas > 1 && (
        <div className="mt-3 flex items-center justify-between gap-4">
          <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </Button>
          <p className="text-muted-foreground text-sm">
            Página <span className="cifra">{datos.pagina}</span> de{' '}
            <span className="cifra">{datos.paginas}</span>
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={pagina >= datos.paginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}
    </>
  );
}

export function Gestion({ perfil }: { perfil: Perfil }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gestión</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="profesores">
          <TabsList className="mb-4">
            <TabsTrigger value="profesores">Profesores</TabsTrigger>
            <TabsTrigger value="lugares">Espacios</TabsTrigger>
            <TabsTrigger value="auditoria">Auditoría</TabsTrigger>
          </TabsList>
          <TabsContent value="profesores"><Profesores perfil={perfil} /></TabsContent>
          <TabsContent value="lugares"><Lugares /></TabsContent>
          <TabsContent value="auditoria"><Auditoria /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
