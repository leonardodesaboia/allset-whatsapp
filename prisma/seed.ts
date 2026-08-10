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

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@allset.app";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "Allset@admin123";
  const name = process.env.SEED_ADMIN_NAME ?? "Admin";

  const existing = await prisma.authUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Usuário já existe: ${email}`);
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

  console.log(`Admin criado com sucesso!`);
  console.log(`Email: ${email}`);
  console.log(`Senha: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
