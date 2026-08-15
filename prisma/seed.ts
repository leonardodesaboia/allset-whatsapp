import { randomBytes, scrypt, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (err, derived) => (err ? reject(err) : resolve(derived))
    )
  );
  return `${salt}:${key.toString("hex")}`;
}

/**
 * Cria a credencial do Better Auth (`AuthUser` + `AuthAccount`).
 * Idempotente: se já existir, não recria nem troca a senha.
 */
async function seedCredential(email: string, password: string, name: string): Promise<void> {
  const existing = await prisma.authUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Credencial já existe: ${email}`);
    return;
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    const user = await tx.authUser.create({
      data: {
        id: randomUUID(),
        email,
        emailVerified: true,
        name,
      },
    });

    await tx.authAccount.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        providerId: "credential",
        accountId: email,
        passwordHash,
      },
    });
  });

  console.log(`Credencial criada: ${email}`);
}

/**
 * Cria o `User` de domínio com papel ADMIN e o `AdminProfile`.
 *
 * O `AdminLayout` autentica pelo Better Auth mas **autoriza** procurando um
 * `User` com `role: "ADMIN"` e o mesmo email da sessão. Sem este registro o
 * login é aceito e o admin é imediatamente redirecionado de volta para
 * `/login` — por isso as duas partes precisam ser semeadas juntas.
 */
async function seedDomainAdmin(email: string, name: string, phoneE164: string): Promise<void> {
  const existing = await prisma.user.findFirst({ where: { email } });

  if (existing) {
    if (existing.role !== "ADMIN") {
      throw new Error(
        `Já existe um User com o email ${email} e papel ${existing.role}. ` +
          "Use outro SEED_ADMIN_EMAIL ou promova-o manualmente.",
      );
    }
    // O perfil pode faltar se um seed anterior tiver sido interrompido.
    await prisma.adminProfile.upsert({
      where: { userId: existing.id },
      create: { userId: existing.id },
      update: {},
    });
    console.log(`User de domínio ADMIN já existe: ${email}`);
    return;
  }

  const telefoneEmUso = await prisma.user.findUnique({ where: { phoneE164 } });
  if (telefoneEmUso) {
    throw new Error(
      `O telefone ${phoneE164} já pertence ao usuário ${telefoneEmUso.email ?? telefoneEmUso.id}. ` +
        "Defina SEED_ADMIN_PHONE com outro número.",
    );
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { role: "ADMIN", fullName: name, email, phoneE164 },
    });
    await tx.adminProfile.create({ data: { userId: user.id } });
  });

  console.log(`User de domínio ADMIN criado: ${email}`);
}

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@allset.app";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "Allset@admin123";
  const name = process.env.SEED_ADMIN_NAME ?? "Admin";
  // Não pode colidir com os telefones fixos de `tests/e2e/seed.ts`
  // (+5585990000000 para o admin de E2E, +5585990000001 para a lead de exemplo):
  // `User.phoneE164` é único, e uma colisão quebraria o globalSetup do Playwright.
  const phoneE164 = process.env.SEED_ADMIN_PHONE ?? "+5585990009999";

  await seedCredential(email, password, name);
  await seedDomainAdmin(email, name, phoneE164);

  console.log(`\nAdmin pronto para login.`);
  console.log(`Email: ${email}`);
  console.log(`Senha: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
