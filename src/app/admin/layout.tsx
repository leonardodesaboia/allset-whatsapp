import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";
import { SignOutButton } from "./sign-out-button";
import Link from "next/link";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user.email) {
    redirect("/login");
  }
  const admin = await prisma.user.findFirst({
    where: { email: session.user.email, role: "ADMIN" },
    select: { id: true },
  });
  if (!admin) redirect("/login");
  return (
    <div>
      <header>
        <span>AllSet Admin</span>
        <nav aria-label="Navegação administrativa">
          <Link href="/admin/bookings">Agendamentos</Link>
          <Link href="/admin/customer-conversations">Conversas de clientes</Link>
          <Link href="/admin/recruitment">Profissionais</Link>
          <Link href="/admin/settings/pricing">Preços</Link>
        </nav>
        <SignOutButton />
      </header>
      <main>{children}</main>
    </div>
  );
}
