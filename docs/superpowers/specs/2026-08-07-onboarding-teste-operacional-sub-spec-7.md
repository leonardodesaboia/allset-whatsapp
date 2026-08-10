# Onboarding e teste operacional — Sub-spec 7

## Objetivo

Registrar onboarding ultrassimples e um teste operacional simulado antes de a
profissional entrar em validação. A conclusão e aprovação são decisões humanas
auditáveis.

## Modelo

- `OnboardingContent`: chave, título, texto, áudio/vídeo opcional por storage
  key, ordem e ativo.
- `LeadOnboardingProgress`: lead, conteúdo, concluído em e canal.
- `OperationalTest`: lead, estado e resultado (`PASSED`,
  `PASSED_WITH_SUPPORT`, `FAILED`), suporte e decisão do admin.
- `OperationalTestEvent`: aceite, estou indo, cheguei, terminei ou ajuda.

## Regras

- Apenas conteúdos ativos e curtos; não criar curso ou questionário longo.
- Teste é oportunidade fictícia, nunca cria Booking ou cobrança.
- Ajuda não reprova automaticamente.
- Somente uma decisão explícita move o lead para `EM_VALIDACAO`.
- Eventos e decisões são auditados e visíveis na timeline.

## Limites

Nesta etapa, o admin registra e controla o teste. O envio automático dos
comandos pelo WhatsApp será conectado ao ConversationEngine/provider depois.
