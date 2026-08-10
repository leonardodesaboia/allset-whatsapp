import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { BookingForm } from "../booking-form";

export default async function NewBookingPage() {
  const services = await prisma.serviceDefinition.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="p-6 max-w-xl space-y-5">
      <Link
        href="/admin/bookings"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Agendamentos
      </Link>

      <div>
        <h1 className="text-xl font-bold text-slate-900">Novo agendamento</h1>
        <p className="text-sm text-slate-500 mt-0.5">Cadastro manual de serviço</p>
      </div>

      <BookingForm services={services} />
    </div>
  );
}
