# Entrevista humana e referências — Sub-spec 5

**Depende de:** Sub-specs 1–4  
**Escopo:** operação interna do administrador; nenhuma mensagem automática a
referência.

## Objetivo

Permitir que o administrador registre entrevista, avaliação confidencial e
uma ou mais referências de um lead, mantendo cada decisão manual, auditável e
visível na linha do tempo.

## Modelo

- `LeadInterview`: lead, entrevistador, início/fim, respostas livres e
  resultado (`REFERENCIA`, `AGUARDANDO_COMPLEMENTACAO`, `BASE_FUTURA`,
  `REPROVADA`).
- `LeadAssessment`: avaliação interna por critério (`POSITIVO`, `NEUTRO`,
  `ATENCAO`) e nota confidencial.
- `ProfessionalReference`: nome, telefone, relação e status (`PENDING`,
  `CONTACTED`, `CONFIRMED`, `INCONCLUSIVE`, `NEGATIVE`).
- `ReferenceVerification`: roteiro, comentário, `wouldHireAgain` e quem
  verificou.

Nada disso é exposto em mensagem outbound. Os dados de referência são PII e
devem aparecer somente a admins autorizados.

## Regras

- Entrevista não é formulário obrigatório; todas as respostas são opcionais.
- Reprovação e pré-aprovação são decisões humanas explícitas.
- Transições de status reutilizam a máquina do funil, histórico, versão,
  evento e auditoria.
- Uma referência negativa não reprova automaticamente.

## Aceite

1. Admin inicia e conclui entrevista com notas livres.
2. Admin registra avaliação confidencial e referências.
3. Admin registra resultado da verificação e `wouldHireAgain`.
4. Perfil mostra entrevista/referências e timeline; dados não entram na outbox.
5. Todas as escritas têm testes de integração e auditoria.
