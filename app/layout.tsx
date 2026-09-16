import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Ciudad Activa',
    template: '%s · Ciudad Activa',
  },
  description:
    'Registro de actividades del programa Ciudad Activa — Dirección de Deportes y ' +
    'Recreación, Municipalidad de San Miguel de Tucumán.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#14684f',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${geist.variable} h-full antialiased`}>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
