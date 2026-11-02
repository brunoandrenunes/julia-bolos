import "@/app/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Julia Ronsoni Bolos | Sistema",
  description: "Gestão de estoque, compras, financeiro e DRE do negócio.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
