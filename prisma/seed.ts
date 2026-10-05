import { randomBytes, scrypt, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_ADMIN_EMAIL = "admin@allset.app";
const DEFAULT_ADMIN_NAME = "Admin";
const DEFAULT_ADMIN_PHONE_E164 = "+5585999999999";

export type AdminSeedConfig = Readonly<{
  email: string;
  password: string;
  name: string;
  phoneE164: string;
}>;

/**
 * Loads the minimum bootstrap data without ever providing a known password.
 * A production deployment must inject SEED_ADMIN_PASSWORD through its secret
 * manager before running `prisma db seed`.
 */
export function readAdminSeedConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AdminSeedConfig {
  const email = (environment.SEED_ADMIN_EMAIL ?? DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const password = environment.SEED_ADMIN_PASSWORD;
  const name = (environment.SEED_ADMIN_NAME ?? DEFAULT_ADMIN_NAME).trim();
  const phoneE164 = (environment.SEED_ADMIN_PHONE_E164 ?? DEFAULT_ADMIN_PHONE_E164).trim();

  if (!password) {
    throw new Error(
      "SEED_ADMIN_PASSWORD é obrigatória. Defina uma senha única no gerenciador de segredos antes de executar o seed.",
    );
  }
  if (password.length < 10) {
    throw new Error("SEED_ADMIN_PASSWORD deve ter pelo menos 10 caracteres.");
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error("SEED_ADMIN_EMAIL deve conter um e-mail válido.");
  }
  if (!name) {
    throw new Error("SEED_ADMIN_NAME não pode ser vazio.");
  }
  if (!/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
    throw new Error("SEED_ADMIN_PHONE_E164 deve estar no formato E.164.");
  }

  return { email, password, name, phoneE164 };
}

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

export async function bootstrapAdmin(
  client: PrismaClient,
  config: AdminSeedConfig,
): Promise<void> {
  const passwordHash = await hashPassword(config.password);

  await client.$transaction(async (tx) => {
    const authUser = await tx.authUser.upsert({
      where: { email: config.email },
      create: {
        id: randomUUID(),
        email: config.email,
        emailVerified: true,
        name: config.name,
      },
      update: {},
    });

    const credential = await tx.authAccount.findUnique({
      where: {
        providerId_accountId: {
          providerId: "credential",
          accountId: config.email,
        },
      },
    });
    if (credential && credential.userId !== authUser.id) {
      throw new Error(
        `A credencial de ${config.email} já pertence a outra conta de autenticação.`,
      );
    }
    if (!credential) {
      await tx.authAccount.create({
        data: {
          id: randomUUID(),
          userId: authUser.id,
          providerId: "credential",
          accountId: config.email,
          passwordHash,
        },
      });
    }

    const existingDomainUser = await tx.user.findUnique({
      where: { email: config.email },
      include: { adminProfile: true },
    });
    if (existingDomainUser && existingDomainUser.role !== "ADMIN") {
      throw new Error(
        `O e-mail ${config.email} já está vinculado a um usuário de domínio não administrativo.`,
      );
    }

    const conflictingPhoneUser = await tx.user.findUnique({
      where: { phoneE164: config.phoneE164 },
      select: { email: true },
    });
    if (conflictingPhoneUser && conflictingPhoneUser.email !== config.email) {
      throw new Error(
        `O telefone de bootstrap ${config.phoneE164} já está vinculado a outro usuário de domínio.`,
      );
    }

    const domainAdmin =
      existingDomainUser ??
      (await tx.user.create({
        data: {
          role: "ADMIN",
          fullName: config.name,
          email: config.email,
          phoneE164: config.phoneE164,
        },
        include: { adminProfile: true },
      }));

    if (!domainAdmin.adminProfile) {
      await tx.adminProfile.create({ data: { userId: domainAdmin.id } });
    }
  });
}

async function main() {
  const config = readAdminSeedConfig();
  await bootstrapAdmin(prisma, config);
  console.log(`Admin garantido com sucesso para ${config.email}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
