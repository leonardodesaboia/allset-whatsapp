# Documentos e termos — Sub-spec 6

## Objetivo

Permitir requisitos documentais configuráveis, recebimento privado de arquivos,
revisão administrativa e aceite versionado de termos para profissionais.

## Regras de segurança

- Arquivos usam apenas `StorageProvider`; nunca URL pública persistida.
- Preview é URL assinada curta, obtida somente por admin autorizado.
- Documento recebido não é aprovação; aprovação/rejeição é humana e auditada.
- Termo guarda versão, canal, data e identificador de consentimento. Áudio
  explicativo pode complementar, mas não substituir o texto jurídico.

## Modelo

- `DocumentRequirement`: chave, nome, obrigatório e ativo.
- `ProfessionalDocument`: lead, requisito, storage key, MIME, tamanho e status
  (`PENDING`, `RECEIVED`, `APPROVED`, `REJECTED`, `EXPIRED`).
- `DocumentReview`: decisão, revisor e motivo.
- `TermsVersion`: versão imutável, texto e ativo.
- `TermsAcceptance`: lead, versão, canal, telefone/IP quando aplicável e data.

## Limites

Não há OCR, validação automática de identidade, assinatura digital complexa ou
mensagem Evolution nesta etapa. O fluxo automatizado de pedido de documento
será conectado posteriormente ao ConversationEngine.
