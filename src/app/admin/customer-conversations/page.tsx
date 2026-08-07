import { prisma } from "@/infrastructure/db/prisma-client";
import { CustomerConversationMessageForm } from "./customer-conversation-message-form";

export default async function CustomerConversationsPage() {
  const conversations = await prisma.customerBookingConversation.findMany({
    where: { bookingId: null, state: { not: "COMPLETED" } },
    orderBy: { updatedAt: "asc" },
    include: { customer: { select: { fullName: true, phoneE164: true } } },
    take: 100,
  });
  return <section>
    <h1>Conversas de clientes</h1>
    <p>Converse manualmente ou pause a automação antes da criação do pedido.</p>
    {conversations.length === 0 ? <p>Nenhuma conversa sem pedido em andamento.</p> : <table>
      <thead><tr><th>Cliente</th><th>Etapa</th><th>Última atividade</th><th>Ação</th></tr></thead>
      <tbody>{conversations.map((conversation) => <tr key={conversation.id}>
        <td>{conversation.customer.fullName}<br />{conversation.customer.phoneE164}</td>
        <td>{conversation.state}</td>
        <td>{conversation.updatedAt.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}</td>
        <td><CustomerConversationMessageForm conversationId={conversation.id} /></td>
      </tr>)}</tbody>
    </table>}
  </section>;
}
