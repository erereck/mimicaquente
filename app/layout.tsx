import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mímica Quente",
  description: "Batata quente de mímica para jogar com os amigos.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
