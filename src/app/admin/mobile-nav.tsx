"use client";

import { useState } from "react";
import { Menu, X, Sparkles } from "lucide-react";
import { NavLinkClient } from "./nav-link-client";
import { SignOutButton } from "./sign-out-button";

interface MobileNavProps {
  admin: { fullName: string | null; email: string };
  initials: string;
}

export function MobileNav({ admin, initials }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
  }

  return (
    <>
      <header className="flex lg:hidden items-center h-14 px-4 bg-slate-900 border-b border-white/10 shrink-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-slate-400 hover:text-white transition-colors"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-blue-600 shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-white font-semibold text-sm tracking-tight">AllSet</span>
        </div>
        <div className="w-5" aria-hidden="true" />
      </header>

      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          aria-modal="true"
          role="dialog"
          aria-label="Menu de navegação"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={close}
            aria-hidden="true"
          />

          <aside className="absolute left-0 top-0 bottom-0 w-64 flex flex-col bg-slate-900 shadow-xl">
            <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/10 shrink-0">
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-blue-600 shrink-0">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="text-white font-semibold text-sm tracking-tight">AllSet</span>
              <span className="ml-auto text-[10px] font-medium text-slate-500">ADMIN</span>
              <button
                type="button"
                onClick={close}
                className="text-slate-400 hover:text-white transition-colors ml-1"
                aria-label="Fechar menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex-1 py-4 px-2 space-y-0.5 overflow-y-auto">
              <NavLinkClient href="/admin" label="Painel" iconName="LayoutDashboard" exact onClick={close} />
              <NavLinkClient href="/admin/bookings" label="Agendamentos" iconName="Calendar" onClick={close} />
              <NavLinkClient href="/admin/recruitment" label="Profissionais" iconName="Users" onClick={close} />
              <NavLinkClient href="/admin/customer-conversations" label="Conversas" iconName="MessageSquare" onClick={close} />
              <NavLinkClient href="/admin/settings/pricing" label="Preços" iconName="Settings" onClick={close} />
            </nav>

            <div className="border-t border-white/10 p-3 shrink-0">
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
        </div>
      )}
    </>
  );
}
