import Link from "next/link";
import { prisma } from "@/infrastructure/db/prisma-client";
import { dispatchOpportunityAction, resumeCustomerAutomationAction, validateBookingCoverageAction } from "./actions";
import { CustomerMessageForm } from "./customer-message-form";

const formatDateTime = (date: Date) => new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Fortaleza",
}).format(date);

export default async function BookingsPage() {
  const bookings = await prisma.booking.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      service: { select: { name: true } },
      customer: { select: { fullName: true, phoneE164: true } },
      customerConversation: { select: { id: true, state: true } },
      opportunities: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Agendamentos</h1>
        <Link href="/admin/bookings/new">Novo agendamento</Link>
      </div>
      {bookings.length === 0 ? <p>Nenhum agendamento criado.</p> : (
        <table>
          <thead><tr><th>Cliente</th><th>Serviço</th><th>Bairro</th><th>Data e hora</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>{bookings.map((booking) => {
            const opportunity = booking.opportunities[0];
            return <tr key={booking.id}>
              <td>{booking.customer.fullName}<br />{booking.customer.phoneE164}</td>
              <td>{booking.service.name}</td>
              <td>{booking.neighborhood ?? "—"}</td>
              <td>{booking.scheduledAt ? formatDateTime(booking.scheduledAt) : "—"}</td>
              <td>{booking.status}</td>
              <td>
                {booking.status === "DRAFT" && <form action={async () => { "use server"; await dispatchOpportunityAction(booking.id); }}><button type="submit">Enviar para matching</button></form>}
                {booking.status === "REVIEW_REQUIRED" && booking.customerConversation && booking.addressLine1 && <>
                  <div>{booking.addressLine1}</div>
                  <form action={async () => { "use server"; await validateBookingCoverageAction(booking.id, true); }}><button type="submit">Endereço atendido</button></form>
                  <form action={async () => { "use server"; await validateBookingCoverageAction(booking.id, false); }}><button type="submit">Adicionar à lista de espera</button></form>
                </>}
                {booking.customerConversation && <CustomerMessageForm bookingId={booking.id} />}
                {booking.customerConversation?.state === "PAUSED" && <form action={async () => { "use server"; await resumeCustomerAutomationAction(booking.id); }}><button type="submit">Retomar automação</button></form>}
                {opportunity && <Link href={`/admin/bookings/${booking.id}/opportunity`}>Oportunidade ({opportunity.status})</Link>}
              </td>
            </tr>;
          })}</tbody>
        </table>
      )}
    </section>
  );
}
