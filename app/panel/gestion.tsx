'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Perfil } from '@/lib/tipos';
import { Auditoria } from './_gestion/auditoria';
import { Configuracion } from './_gestion/configuracion';
import { Espacios } from './_gestion/espacios';
import { Profesores } from './_gestion/profesores';

/**
 * Administración del sistema. Cada solapa vive en su propio archivo bajo
 * _gestion/: el guion bajo le dice a Next que es una carpeta interna y no una
 * ruta.
 */
export function Gestion({ perfil }: { perfil: Perfil }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gestión del sistema</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="personas">
          <TabsList className="mb-4">
            <TabsTrigger value="personas">Personas</TabsTrigger>
            <TabsTrigger value="espacios">Espacios</TabsTrigger>
            <TabsTrigger value="configuracion">Configuración</TabsTrigger>
            <TabsTrigger value="auditoria">Auditoría</TabsTrigger>
          </TabsList>

          <TabsContent value="personas"><Profesores perfil={perfil} /></TabsContent>
          <TabsContent value="espacios"><Espacios /></TabsContent>
          <TabsContent value="configuracion"><Configuracion /></TabsContent>
          <TabsContent value="auditoria"><Auditoria /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
