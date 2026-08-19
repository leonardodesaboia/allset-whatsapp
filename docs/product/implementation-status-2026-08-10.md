# AllSet — Status de infraestrutura (histórico saneado)

> Atualizado em 2026-08-19. Este documento não guarda senhas, tokens, hashes,
> chaves de API, URLs de conexão ou endereços de infraestrutura.

## Situação conhecida

- A aplicação depende de PostgreSQL, Evolution API e storage S3 compatível.
- Em produção, as cinco variáveis `S3_*` obrigatórias precisam estar definidas;
  o runtime não usa mais storage local como fallback.
- Jobs frequentes devem chamar as rotas de cron autenticadas para dispatch,
  expiração, reengajamento e download/transcrição de áudio.
- O primeiro admin é criado somente pelo seed seguro, que exige
  `SEED_ADMIN_PASSWORD` e cria tanto a conta de autenticação quanto o perfil
  administrativo de domínio.

## Ação obrigatória após o vazamento histórico

As credenciais anteriormente registradas neste arquivo devem ser consideradas
comprometidas. Rotacione, no respectivo provedor:

1. senha de PostgreSQL e qualquer URL de conexão derivada;
2. credenciais do administrador;
3. chaves da Evolution, MinIO/S3 e OpenAI;
4. segredos de webhook, cron, jobs internos e Better Auth.

Depois, atualize os valores apenas no gerenciador de segredos da infraestrutura.
Nunca registre valores reais em documentação, arquivos de ambiente versionados
ou comandos de exemplo.
