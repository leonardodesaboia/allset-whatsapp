import { notFound } from "next/navigation";
import { prisma } from "@/infrastructure/db/prisma-client";

const formatDateTime = (date: Date) => new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza",
}).format(date);

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      opportunities: {
        orderBy: { createdAt: "desc" }, take: 1,
        include: { responses: { orderBy: { sentAt: "asc" }, include: { lead: { select: { fullName: true, phoneE164: true, neighborhood: true } } } } },
      },
    },
  });
  if (!booking) notFound();
  const opportunity = booking.opportunities[0];

  return <section>
    <h1>Oportunidade do agendamento</h1>
    <p>Status do agendamento: <strong>{booking.status}</strong></p>
    {!opportunity ? <p>Nenhuma oportunidade foi enviada ainda.</p> : <>
      <p>Status: <strong>{opportunity.status}</strong></p>
      <p>Bairro: {opportunity.neighborhood}. Expira: {formatDateTime(opportunity.expiresAt)}.</p>
      <table>
        <thead><tr><th>Profissional</th><th>Bairro</th><th>Enviado</th><th>Resposta</th><th>Respondido</th></tr></thead>
        <tbody>{opportunity.responses.map((response) => <tr key={response.id}>
          <td>{response.lead.fullName ?? "—"}<br />{response.lead.phoneE164 ?? "—"}</td>
          <td>{response.lead.neighborhood ?? "—"}</td>
          <td>{formatDateTime(response.sentAt)}</td>
          <td>{response.response ?? "Aguardando"}</td>
          <td>{response.respondedAt ? formatDateTime(response.respondedAt) : "—"}</td>
        </tr>)}</tbody>
      </table>
    </>}
  </section>;
}
