"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Users,
  MessageSquare,
  Settings,
  Wifi,
  FileCheck,
  Send,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Calendar,
  Users,
  MessageSquare,
  Settings,
  Wifi,
  FileCheck,
  Send,
};

export function NavLinkClient({
  href,
  label,
  iconName,
  exact,
  onClick,
  badge,
}: {
  href: string;
  label: string;
  iconName: string;
  exact?: boolean;
  onClick?: () => void;
  badge?: number | undefined;
}) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname.startsWith(href);
  const Icon = ICONS[iconName];

  return (
    <Link
      href={href}
      {...(onClick ? { onClick } : {})}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
        isActive
          ? "bg-blue-600 text-white"
          : "text-slate-400 hover:text-white hover:bg-white/[0.08]"
      )}
    >
      {Icon && <Icon className="w-4 h-4 shrink-0" />}
      <span className="flex-1">{label}</span>
      {badge ? (
        <span
          className={cn(
            "min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums leading-none",
            isActive ? "bg-white/25 text-white" : "bg-amber-500 text-slate-900"
          )}
          aria-label={`${badge} pendente${badge > 1 ? "s" : ""}`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}
