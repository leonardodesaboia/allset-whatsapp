import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";
import { NavLinkClient } from "./nav-link-client";
import { SignOutButton } from "./sign-out-button";
import { MobileNav } from "./mobile-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user.email) redirect("/login");

  const admin = await prisma.user.findFirst({
    where: { email: session.user.email, role: "ADMIN" },
    select: { id: true, email: true, fullName: true },
  });
  if (!admin) redirect("/login");

  const initials = (admin.fullName ?? admin.email)
    .split(/[\s@]/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar — desktop only */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 bg-slate-900">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/10">
          <div className="flex items-center justify-center w-7 h-7 rounded-md bg-blue-600 shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-semibold text-sm tracking-tight">AllSet</span>
          <span className="ml-auto text-[10px] font-medium text-slate-500">ADMIN</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-0.5">
          <NavLinkClient href="/admin" label="Painel" iconName="LayoutDashboard" exact />
          <NavLinkClient href="/admin/bookings" label="Agendamentos" iconName="Calendar" />
          <NavLinkClient href="/admin/recruitment" label="Profissionais" iconName="Users" />
          <NavLinkClient href="/admin/customer-conversations" label="Conversas" iconName="MessageSquare" />
          <NavLinkClient href="/admin/settings/pricing" label="Preços" iconName="Settings" />
        </nav>

        {/* User */}
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 px-1 py-1">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate leading-tight">
                {admin.fullName ?? "Admin"}
              </p>
              <p className="text-[10px] text-slate-500 truncate">{admin.email}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <MobileNav admin={{ fullName: admin.fullName, email: admin.email ?? "" }} initials={initials} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
