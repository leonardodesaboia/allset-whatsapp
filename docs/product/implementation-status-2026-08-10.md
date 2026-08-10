# AllSet — Status de Infraestrutura (2026-08-10)

## Vercel

- URL: `https://allset-whatsapp.vercel.app`
- Plano: Hobby — crons limitados a schedule diário (`0 0 * * *`)
- Crons frequentes (outbox, expiry, process) configurados no **cron-job.org** com header `Authorization: Bearer <CRON_SECRET>`

**Variáveis de ambiente (Production):**

| Variável | Status |
|---|---|
| `DATABASE_URL` | ⚠️ hostname interno — ver bloqueador abaixo |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | ✅ |
| `EVOLUTION_BASE_URL` / `API_KEY` / `INSTANCE` / `WEBHOOK_SECRET` | ✅ |
| `INTERNAL_JOB_SECRET` / `CRON_SECRET` | ✅ |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` / `S3_PUBLIC_URL` | ✅ |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | ❌ vazios |

---

## Easypanel — VPS `72.61.32.149`

| Container | Serviço |
|---|---|
| `allset_mvp_allset-db` | PostgreSQL do AllSet |
| `allset_mvp_evolution-api` | Evolution API (WhatsApp) |
| `allset_mvp_evolution-api-db` | PostgreSQL da Evolution |
| `allset_mvp_evolution-api-redis` | Redis da Evolution |
| `allset_mvp_minio` | MinIO (S3-compatível) |

---

## Bloqueador principal: banco inacessível pela Vercel

`allset_mvp_allset-db` é um hostname interno da rede Docker do Easypanel. A Vercel não consegue alcançá-lo.

**Solução:** no Easypanel, abrir o serviço `allset-db` → **Ports** → adicionar `5432 → 5432`, depois atualizar `DATABASE_URL` na Vercel:

```
postgres://postgres:h3qb46ox0yrplwzkdtum@72.61.32.149:5432/allset_mvp?sslmode=disable
```

---

## Criação do usuário admin

Enquanto o banco não está acessível externamente, criar via Easypanel terminal:

```bash
docker exec -i allset_mvp_allset-db.1.gig3il678r7czg94m8vdma79j \
  psql -U postgres allset_mvp << 'SQL'
INSERT INTO "AuthUser" (id, email, "emailVerified", name, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'leonardodesaboia1@gmail.com', true, 'Leonardo', NOW(), NOW())
ON CONFLICT (email) DO NOTHING;

INSERT INTO "AuthAccount" (id, "userId", "providerId", "accountId", "passwordHash", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  (SELECT id FROM "AuthUser" WHERE email = 'leonardodesaboia1@gmail.com'),
  'credential',
  'leonardodesaboia1@gmail.com',
  'd39bbf5e387625b42b617d2246656d4f:ed6035e7461b98b8b30060a8e78fdad4289d54b5843a3b9ed4db60cf698eeacca97001f171746081829f182eb4b3acaea66d149a7f5b8964e2c00900717ee7df',
  NOW(), NOW()
)
ON CONFLICT ("providerId", "accountId") DO NOTHING;
SQL
```

Senha: `Allset@admin123`

Para ambientes futuros: `DATABASE_URL="..." pnpm prisma db seed`

---

## Pendências

- [ ] Expor porta 5432 no Easypanel e atualizar `DATABASE_URL` na Vercel
- [ ] Configurar credenciais MinIO (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`)
- [ ] Configurar webhook secret na Evolution API
- [ ] Deletar `src/app/api/setup/admin/route.ts` após criar o usuário admin
