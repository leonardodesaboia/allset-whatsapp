# Visão geral dos fluxos

O AllSet cobre hoje **quatro domínios de fluxo** que se encontram em um único
ponto de entrada (o webhook do WhatsApp) e em um único ponto de saída (a outbox).

```
                    ┌──────────────────────────────────────────┐
                    │  POST /api/messaging/evolution/webhook    │
                    └───────────────────┬──────────────────────┘
                                        │ InboundMessage
      ┌─────────────────────────────────┼─────────────────────────────────┐
      ▼                                 ▼                                 ▼
 resposta de                          áudio                             texto
 oportunidade                            │                                │
      │                        download + Whisper                         │
      ▼                                  └──────────► texto ──────────────┤
 ┌──────────┐                                                             ▼
 │MARKETPLACE│                                             ┌──────────────────────────┐
 └──────────┘                                              │ roteador de conversa      │
                                                           └────┬──────────┬──────────┘
                                                                ▼          ▼
                                                        ┌───────────┐ ┌────────────┐
                                                        │ CLIENTE   │ │ RECRUTAMENTO│
                                                        └─────┬─────┘ └──────┬──────┘
                                                              ▼              ▼
                                                        Booking          RecruitmentLead
                                                              └──────┬───────┘
                                                                     ▼
                                                            ┌────────────────┐
                                                            │ ADMIN (Kanban) │
                                                            └────────────────┘
```

---

## Fluxo A — Triagem de intenção

Quem manda mensagem pela primeira vez não é assumido como profissional nem como
cliente. Um menu neutro de duas opções decide o caminho e o estado fica gravado
em `ContactIntentConversation`.

→ [exemplos/01-triagem-de-intencao.md](exemplos/01-triagem-de-intencao.md)

---

## Fluxo B — Recrutamento de profissionais

Nove estados de conversa (`RecruitmentConversationState`) coletam nome, bairro,
experiência, área de atendimento e disponibilidade. Ao final, uma **triagem
automática** decide entre `CONVERSA_PENDENTE`, `AGUARDANDO_COMPLEMENTACAO` ou
`BASE_FUTURA`.

Depois disso, o funil administrativo tem 21 status — de `LEAD` até `ATIVA` /
`PREFERENCIAL`, passando por entrevista, referências, documentação, onboarding,
teste operacional e validação.

→ [exemplos/02-pre-cadastro-profissional.md](exemplos/02-pre-cadastro-profissional.md)
→ [exemplos/09-reengajamento.md](exemplos/09-reengajamento.md)
→ [exemplos/10-funil-administrativo.md](exemplos/10-funil-administrativo.md)

---

## Fluxo C — Agendamento pelo cliente

Conversa de cotação: confirmação de intenção → nome → faixa de imóvel
(`PropertyPricingTier`) → data → horário → orçamento → aceite → endereço →
revisão manual de cobertura → confirmação de pagamento.

Cada avanço move também o `Booking` na sua própria máquina de estados
(`DRAFT → COLLECTING_DATA → QUOTED → QUOTE_ACCEPTED → REVIEW_REQUIRED → …`).

→ [exemplos/03-agendamento-cliente.md](exemplos/03-agendamento-cliente.md)
→ [exemplos/04-validacao-de-cobertura.md](exemplos/04-validacao-de-cobertura.md)

---

## Fluxo D — Marketplace de oportunidades

Um pedido pago/validado vira uma `ServiceOpportunity` oferecida por WhatsApp a
todas as profissionais elegíveis ao mesmo tempo. A primeira que responde "SIM"
fica com o serviço; as demais recebem aviso de que a vaga foi preenchida. Sem
aceite até o prazo, um job expira a oferta.

→ [exemplos/05-oportunidade-marketplace.md](exemplos/05-oportunidade-marketplace.md)
→ [exemplos/06-expiracao-de-oportunidade.md](exemplos/06-expiracao-de-oportunidade.md)

---

## Fluxo E — Infraestrutura de mensageria

Transversal aos anteriores: **toda** mensagem de saída passa pela outbox, com
lease, retry exponencial e dead letter. Áudios recebidos passam por download +
transcrição antes de voltarem ao roteador como texto.

→ [exemplos/07-outbox-de-mensagens.md](exemplos/07-outbox-de-mensagens.md)
→ [exemplos/08-audio-e-transcricao.md](exemplos/08-audio-e-transcricao.md)

---

## Como os fluxos se conectam

| Evento | Consequência em outro fluxo |
|---|---|
| Pré-cadastro concluído com área compatível | Lead entra no funil administrativo (`CONVERSA_PENDENTE`) |
| Admin decide validação como `ATIVA` | Lead vira `ProfessionalProfile` e passa a ser elegível a oportunidades |
| Cliente aceita orçamento e endereço é validado | `Booking` fica pronto para virar `ServiceOpportunity` |
| Profissional aceita oportunidade | `Booking` vai para `PROFESSIONAL_ASSIGNED` com `assignedProfessionalLeadId` |
| Oportunidade expira | `Booking` volta para `REVIEW_REQUIRED` — a operação decide o que fazer |
| Qualquer um dos anteriores | Uma ou mais linhas em `OutboxMessage`, despachadas pelo worker |
