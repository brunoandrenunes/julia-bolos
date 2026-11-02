import { AppShell } from "@/components/app-shell";
import { exigirDono } from "@/lib/auth";

export default async function SistemaLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await exigirDono();
  return <AppShell>{children}</AppShell>;
}
