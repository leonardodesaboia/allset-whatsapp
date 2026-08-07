# Validação, ativação e profissional preferencial — Sub-spec 8

## Objetivo

Controlar o período de validação após o teste operacional, registrar evidências
dos primeiros serviços e permitir ativação, pausa, reprovação ou promoção a
preferencial por decisão humana.

## Modelo

- `ValidationPolicy`: quantidade configurável de serviços requerida.
- `ValidationServiceRecord`: serviço vinculado, pontualidade, avaliação,
  problema, recontratação e observações.
- `ValidationDecision`: elegibilidade calculada, decisão humana, ator e motivo.

## Regras

- Ativação automática é proibida: elegibilidade apenas sugere decisão.
- `EM_VALIDACAO` só recebe registros de serviços reais depois que matching
  estiver disponível; neste sub-spec, aceita identificador externo auditável.
- `ATIVA`, `PAUSADA`, `REPROVADA` e `PREFERENCIAL` usam a mesma máquina de
  estados e auditoria centralizadas.
- Critérios de preferencial permanecem manuais no MVP.

## Limites

Não implementar matching, pagamentos, pesquisa ao cliente ou métricas globais
completas aqui. Os registros deixam interfaces prontas para essas integrações.
