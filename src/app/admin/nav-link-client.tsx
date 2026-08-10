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
}: {
  href: string;
  label: string;
  iconName: string;
  exact?: boolean;
  onClick?: () => void;
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
      {label}
    </Link>
  );
}
