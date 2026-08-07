import { prisma } from "@/infrastructure/db/prisma-client";
import { BookingForm } from "../booking-form";

export default async function NewBookingPage() {
  const services = await prisma.serviceDefinition.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return <section><h1>Novo agendamento</h1><BookingForm services={services} /></section>;
}
