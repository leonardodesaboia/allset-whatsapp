"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Menu, X, Sparkles } from "lucide-react";
import { NavLinkClient } from "./nav-link-client";
import { SignOutButton } from "./sign-out-button";

interface MobileNavProps {
  admin: { fullName: string | null; email: string };
  initials: string;
}

export function MobileNav({ admin, initials }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  function close({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;

    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;

    const first = focusable.item(0);
    const last = focusable.item(focusable.length - 1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <header className="flex lg:hidden items-center h-14 px-4 bg-slate-900 border-b border-white/10 shrink-0">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center text-slate-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          aria-label="Abrir menu"
          aria-expanded={open}
          aria-controls="admin-mobile-navigation"
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
          ref={dialogRef}
          className="fixed inset-0 z-40 lg:hidden"
          aria-modal="true"
          role="dialog"
          aria-label="Menu de navegação"
          onKeyDown={trapFocus}
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => close({ restoreFocus: false })}
            aria-hidden="true"
          />

          <aside id="admin-mobile-navigation" className="absolute left-0 top-0 bottom-0 flex w-64 flex-col bg-slate-900 shadow-xl">
            <div className="flex items-center gap-2.5 px-4 h-14 border-b border-white/10 shrink-0">
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-blue-600 shrink-0">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="text-white font-semibold text-sm tracking-tight">AllSet</span>
              <span className="ml-auto text-[10px] font-medium text-slate-500">ADMIN</span>
              <button
                ref={closeRef}
                type="button"
                onClick={() => close()}
                className="ml-1 inline-flex min-h-11 min-w-11 items-center justify-center text-slate-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
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
              <p className="px-2 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Operação</p>
              <NavLinkClient href="/admin/documents" label="Documentos" iconName="FileCheck" onClick={close} />
              <NavLinkClient href="/admin/outbox" label="Mensagens" iconName="Send" onClick={close} />
              <p className="px-2 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Configurações</p>
              <NavLinkClient href="/admin/settings/pricing" label="Preços" iconName="Settings" onClick={close} />
              <NavLinkClient href="/admin/settings/evolution" label="WhatsApp" iconName="Wifi" onClick={close} />
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
