# Entrevista humana e referências — plano

## 1. Schema e migration

- [ ] Adicionar enums/models de entrevista, avaliação, referência e verificação.
- [ ] Índices por lead e constraints para relações.
- [ ] Criar migration aditiva e testar em Postgres.

## 2. Casos de uso

- [ ] Iniciar/concluir entrevista e registrar evento/auditoria.
- [ ] Criar avaliação interna e atualizar sem apagar histórico.
- [ ] Adicionar referência e registrar verificação.
- [ ] Mover status apenas pela transição de lead auditada.

## 3. Dashboard

- [ ] Perfil com seções de entrevista e referência, sem saída por mensageria.
- [ ] Ações exigem admin de domínio.

## 4. Testes

- [ ] Unitários para enums/regras.
- [ ] Integração para auditoria, estados e PII.
- [ ] E2E para registrar entrevista e uma referência.
