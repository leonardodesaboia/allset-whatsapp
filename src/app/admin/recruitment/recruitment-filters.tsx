"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, useRef } from "react";
import { Search, BellRing, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function RecruitmentFilters({ needsMeCount }: { needsMeCount: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const activeFilter = params.get("needs") === "1" ? "needs" : params.get("q") ? "search" : "board";

  function applySearch(term: string) {
    const next = new URLSearchParams();
    if (term.trim()) next.set("q", term.trim());
    startTransition(() => router.push(`/admin/recruitment?${next.toString()}`));
  }

  function toggleNeedsMe() {
    if (activeFilter === "needs") {
      startTransition(() => router.push("/admin/recruitment"));
    } else {
      startTransition(() => router.push("/admin/recruitment?needs=1"));
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          applySearch(inputRef.current?.value ?? "");
        }}
        className="flex items-center gap-1.5"
      >
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <Input
            ref={inputRef}
            defaultValue={params.get("q") ?? ""}
            placeholder="Buscar por nome, bairro ou telefone…"
            className="pl-8 w-64"
            aria-label="Buscar profissionais"
            onChange={(e) => { if (e.target.value === "") applySearch(""); }}
          />
        </div>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          Buscar
        </Button>
      </form>

      <Button
        type="button"
        variant={activeFilter === "needs" ? "destructive" : "outline"}
        size="sm"
        onClick={toggleNeedsMe}
        disabled={pending}
        aria-pressed={activeFilter === "needs"}
        className={cn(needsMeCount > 0 && activeFilter !== "needs" && "border-red-200 text-red-600 hover:bg-red-50")}
      >
        <BellRing className="w-3.5 h-3.5 mr-1.5" />
        Precisa de mim{needsMeCount > 0 ? ` (${needsMeCount})` : ""}
      </Button>

      {activeFilter !== "board" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => startTransition(() => router.push("/admin/recruitment"))}
          disabled={pending}
        >
          <LayoutGrid className="w-3.5 h-3.5 mr-1.5" />
          Ver Kanban
        </Button>
      )}
    </div>
  );
}
