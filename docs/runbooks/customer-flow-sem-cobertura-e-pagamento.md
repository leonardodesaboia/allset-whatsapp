# Fluxo do cliente: sem validação de cobertura e sem pagamento

A AllSet só organiza o contato entre cliente e profissional. Não existe mais
validação de cobertura pelo admin nem pagamento pela plataforma.

## Como a conversa fica

Cliente:

1. Nome → faixa do imóvel.
2. Dia e horário (aceita "18/10 às 14h", "18/10 14:00", "dia 18 as 14",
   "amanhã 14h", "14 horas", "2 da tarde", "14hrs", ou a opção do dia + horário,
   ex.: "3 14h"). O bot **confirma o que entendeu** ("Entendi: sábado, 18 de
   outubro às 14:00. Valor estimado …") antes de seguir. Se o horário não
   existir (8h, 9h, 13h, 14h) ou não for entendido, pergunta de novo listando
   os horários. Nunca assume o primeiro horário.
3. Endereço (rua, número e bairro). Se o bairro não puder ser lido do
   endereço, o bot pergunta só o bairro.
4. O pedido vai direto para as profissionais ("Enviamos o seu pedido …").

Profissional: recebe a oportunidade (bairro, dia, horário, **valor estimado**).
Ao responder `SIM <código>`:

- a profissional recebe nome, WhatsApp, endereço, dia/hora e faixa do imóvel do
  cliente;
- o cliente recebe nome e WhatsApp da profissional.

Depois disso a plataforma não acompanha o serviço; valor final e detalhes são
combinados direto entre as partes.

## Conversas já paradas em MANUAL_REVIEW por cobertura

Esses pedidos estão em `Booking.status = REVIEW_REQUIRED` e
`CustomerBookingConversation.state = MANUAL_REVIEW` (ou `PAUSED` com
`lastQuestionKey = MANUAL_REVIEW`). Opções, da mais simples para a mais manual:

1. **Automático:** na próxima mensagem do cliente, a conversa segue sozinha para
   as profissionais (o endereço já salvo é usado).
2. **Admin → Conversas de clientes → conversa → controles (PR #7):**
   - `Retomar` volta para a etapa de endereço e pede o endereço de novo;
   - `Escolher etapa` → `FINAL_CONFIRMATION` reenvia o resumo e o cliente
     responde `1`; o pedido segue para as profissionais (exige endereço e
     horário já salvos; não exige mais cobertura validada).
3. **Admin → Agendamentos:** o botão "Atendido" (legado) ainda existe só para
   esses pedidos antigos; leva à mesma confirmação final.

Pedidos que ficaram em `AWAITING_PAYMENT`: seguem para as profissionais na
próxima mensagem do cliente (o bot avisa que não há mais pagamento). O botão
"Confirmar pagamento manual" foi removido. O cron `customer/expire-stale` não
manda lembrete nem cancela mais por falta de pagamento.

## Pedido sem profissional elegível

O pedido fica em `QUOTE_ACCEPTED` (aparece como parado no painel) e o cliente é
avisado de que ainda estamos buscando. Em Admin → Agendamentos use "Informar
bairro e valor estimado" e "Enviar para matching" quando houver profissionais
elegíveis.

## Sem migração destrutiva

Nenhuma coluna foi apagada (`coverageValidatedAt`, `outsideCoverageArea`,
`professionalPaymentCents` e os status de pagamento seguem no schema). A única
migração é aditiva: o estado `NEIGHBORHOOD` da conversa.
