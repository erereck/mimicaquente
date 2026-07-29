import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mimicaquente.vercel.app"),
  title: "Mímica Quente",
  description: "Batata quente de mímica para jogar com os amigos.",
  openGraph: {
    title: "Mímica Quente",
    description: "Imite rápido. Passe mais rápido ainda.",
    url: "https://mimicaquente.vercel.app",
    siteName: "Mímica Quente",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Mímica Quente — jogo de batata quente com mímicas",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mímica Quente",
    description: "Imite rápido. Passe mais rápido ainda.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
