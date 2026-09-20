# Análise do projeto AllSet

Documentação de leitura: **o que este projeto é, com quais tecnologias foi
construído e quais fluxos ele cobre hoje**, com um exemplo executável por fluxo.

O AllSet é um **marketplace de limpeza doméstica operado por WhatsApp**: o
contato chega por mensagem, é classificado (cliente ou profissional), percorre
uma conversa automatizada por máquina de estados, e uma operação administrativa
acompanha tudo por um dashboard Kanban.

---

## Índice

| Documento | O que contém |
|---|---|
| [01-tecnologias.md](01-tecnologias.md) | Stack completa: runtime, framework, banco, auth, mensageria, storage, IA, testes e tooling |
| [02-arquitetura.md](02-arquitetura.md) | Camadas, regra de dependência, padrões obrigatórios (outbox, `Result`, lock otimista, transações) |
| [03-fluxos-visao-geral.md](03-fluxos-visao-geral.md) | Mapa dos fluxos e como eles se conectam de ponta a ponta |

### Exemplos (um fluxo por arquivo)

| # | Exemplo | Fluxo coberto |
|---|---|---|
| 01 | [Triagem de intenção](exemplos/01-triagem-de-intencao.md) | Primeiro contato no WhatsApp → menu "contratar" vs. "trabalhar" |
| 02 | [Pré-cadastro da profissional](exemplos/02-pre-cadastro-profissional.md) | Conversa de recrutamento + triagem automática ao final |
| 03 | [Agendamento pelo cliente](exemplos/03-agendamento-cliente.md) | Nome → imóvel → data/hora → orçamento → endereço |
| 04 | [Validação de cobertura](exemplos/04-validacao-de-cobertura.md) | Admin valida endereço e destrava a confirmação de pagamento |
| 05 | [Oportunidade no marketplace](exemplos/05-oportunidade-marketplace.md) | Disparo para profissionais elegíveis e regra "primeiro aceite vence" |
| 06 | [Expiração de oportunidade](exemplos/06-expiracao-de-oportunidade.md) | Job que expira ofertas sem aceite e devolve o pedido à revisão |
| 07 | [Outbox de mensagens](exemplos/07-outbox-de-mensagens.md) | Enfileiramento transacional, lease, retry exponencial e dead letter |
| 08 | [Áudio e transcrição](exemplos/08-audio-e-transcricao.md) | Webhook de áudio → download → Whisper → volta para a conversa |
| 09 | [Reengajamento](exemplos/09-reengajamento.md) | Cadastro parado há 24h recebe lembrete automático |
| 10 | [Funil administrativo](exemplos/10-funil-administrativo.md) | Kanban, máquina de estados do lead, override e ativação |

---

## Leitura rápida em 60 segundos

```
WhatsApp (Evolution API)
   │  webhook assinado
   ▼
POST /api/messaging/evolution/webhook ──► InboundMessage (dedup por provider+externalId)
   │
   ├─ resposta de oportunidade? ──► marketplace (SIM/NAO + código)
   ├─ áudio?                    ──► worker de mídia → Whisper → volta como texto
   └─ texto                     ──► roteador de conversa
                                        ├─ sem histórico   → menu de intenção
                                        ├─ intenção CLIENTE → conversa de agendamento
                                        └─ intenção PROFISSIONAL → conversa de recrutamento
                                                   │
                        toda resposta de saída ────┴──► OutboxMessage (na mesma transação)
                                                              │
                                                     worker/cron despacha → Evolution API
```

Nada envia mensagem direto para a Evolution: **tudo passa pela outbox**, o que
torna o envio idempotente e reprocessável. Nenhuma transição de status é feita
com `update({ status })`: **tudo passa pela máquina de estados**, que grava
histórico, evento de domínio e auditoria na mesma transação.

---

## Estado atual

- **Fluxo de texto**: funcional de ponta a ponta (recrutamento, agendamento, marketplace).
- **Fluxo de áudio**: o código está completo (download → transcrição → roteamento),
  mas depende de um scheduler externo chamando o worker — o `vercel.json` só
  agenda o cron de reengajamento hoje. Detalhes em
  [08-audio-e-transcricao.md](exemplos/08-audio-e-transcricao.md).
- **Pagamento**: existe o port (`PaymentProvider`) e o estado `AWAITING_PAYMENT`,
  mas a integração real ainda não existe — só o mock.
