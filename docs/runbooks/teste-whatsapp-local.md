# Teste real do WhatsApp na máquina local

## Acesso preparado

- Painel: http://localhost:3000/login
- E-mail: `admin@allset.local`
- Senha: campo `LOCAL_ADMIN_PASSWORD` no arquivo `.env.local`.
- Conexão/QR Code: http://localhost:3000/admin/settings/evolution
- Evolution local: http://localhost:18080
- Número esperado: `5585987231727`.

No WhatsApp desse número, abra **Aparelhos conectados → Conectar aparelho**
e escaneie o QR Code gerado no painel. Depois, envie **Oi** de outro número
para o número da AllSet e escolha **1** para cliente ou **2** para profissional.
Mensagens enviadas pelo próprio número do bot são ignoradas pelo webhook.

Não é necessário túnel público. A Evolution roda no Docker local e chama
`http://host.docker.internal:3000/api/messaging/evolution/webhook` com o segredo
configurado. O celular conversa pelo WhatsApp; o computador precisa permanecer
ligado, com internet, Docker, app e worker ativos.

## Testar o caminho do cliente

1. Envie `Oi` de outro número e escolha `1`.
2. Escolha a faixa de imóvel de teste, informe `amanhã às 14h` e um endereço.
3. No painel **Agendamentos**, valide a cobertura como **Atendido**.
4. No celular, confira o resumo e confirme.
5. No painel, confirme o pagamento manual, informe bairro e repasse e salve.
6. Envie para matching quando existir uma profissional elegível no banco local.

A faixa inicial é **Teste local — apartamento de 2 quartos**, com valor de
**R$ 150,00** e duração de **180 minutos**, exclusivamente para demonstração.
Ela pode ser desativada e substituída em **Configurações → Preços**. Nenhum
pagamento real é cobrado automaticamente.

O banco local começa sem profissionais ativas. O pré-cadastro pelo WhatsApp
precisa passar pelas etapas de validação do painel antes de receber ofertas.
Sem candidatas elegíveis, o sistema informa isso e mantém o pedido disponível.

## Áudio

Áudios recebidos são baixados pela Evolution e armazenados em `.local/storage`.
O worker tenta transcrevê-los usando a `OPENAI_API_KEY` já existente no `.env`.
É necessário que a chave esteja válida. Texto funciona independentemente da
transcrição. O storage local não gera uma URL HTTPS para enviar arquivos de
áudio pelo bot; esse envio exige storage acessível pela Evolution.

## Iniciar novamente

```powershell
pnpm.cmd local:up
pnpm.cmd local:start
```

`local:start` mantém app, worker e reconciliação periódica na mesma sessão.
Use **Ctrl+C** nessa sessão para parar. Não execute uma segunda sessão enquanto
a primeira estiver ativa: o app usa a porta 3000, que também está no webhook.

Para preparar tudo desde o início:

```powershell
pnpm.cmd local:configure
pnpm.cmd local:up
pnpm.cmd local:migrate
pnpm.cmd local:seed
pnpm.cmd local:evolution
pnpm.cmd local:start
```

`local:configure` não substitui um `.env.local` existente. Senhas, arquivos de
áudio e logs ficam em arquivos ignorados pelo Git. O `.env` da VPS não é alterado.

Os serviços estão no Compose `allset-whatsapp-local`, com dados persistentes:

| Serviço | Porta local |
| --- | --- |
| Banco AllSet | 55432 |
| Redis | 56379 |
| Evolution | 18080 |
| App | 3000 |

As migrações e o seed usam apenas o banco `allset_local`; o seed rejeita outra
porta, host ou nome de banco. A instância criada é `allset-local`.

## Origem da configuração Evolution

Foi fixada a imagem `evoapicloud/evolution-api:v2.3.7`, correspondente à versão
estável listada no [repositório oficial](https://github.com/evolution-foundation/evolution-api/releases).
A configuração por instância usa `headers`, `events`, `byEvents` e `base64`,
conforme o [contrato da versão 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/integrations/event/event.dto.ts).
