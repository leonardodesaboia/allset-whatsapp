# Análise de correções e MinIO — histórico saneado

> Atualizado em 2026-08-19. Este registro preserva recomendações sem conter
> credenciais, hashes, tokens, IPs ou URLs de infraestrutura.

## Correções aplicadas

- Bootstrap do admin unificado e seguro pelo seed; sem senha conhecida no
  código ou logs e sem endpoint remoto de setup.
- Storage S3 obrigatório em produção; MinIO precisa de credenciais próprias,
  bucket privado e URL pública funcional para URLs assinadas.
- O worker de áudio existe e deve ser agendado junto aos demais crons.
- O projeto usa pnpm como único gerenciador; o lockfile de npm foi removido.
- Dependências e componentes sem uso foram removidos do inventário do projeto.

## Checklist operacional

1. Criar bucket privado e usuário MinIO de privilégio mínimo.
2. Configurar todas as variáveis `S3_*`, incluindo a URL pública assinável.
3. Rodar migrations, gerar o admin com uma senha provida por secret manager e
   verificar o login no painel.
4. Agendar dispatch, expiração, reengajamento e processamento de áudio.
5. Rotacionar qualquer credencial que tenha aparecido em documentação anterior.
