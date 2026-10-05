import { env } from "../src/env";
import { auth } from "../src/infrastructure/auth/auth";
import { prisma } from "../src/infrastructure/db/prisma-client";

const url = new URL(env.DATABASE_URL);
if (env.NODE_ENV !== "development" || url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/allset_local") {
  throw new Error("Seed local só pode gravar no banco allset_local da porta 55432.");
}
const email = process.env.LOCAL_ADMIN_EMAIL;
const password = process.env.LOCAL_ADMIN_PASSWORD;
if (!email || !password) throw new Error("Credenciais locais não configuradas.");
try {
  if (!await prisma.authUser.findUnique({ where: { email } })) {
    await auth.api.signUpEmail({ body: { email, password, name: "Admin Local" } });
  }
  const admin = await prisma.user.upsert({
    where: { email }, create: { email, role: "ADMIN", fullName: "Admin Local", phoneE164: "+5585900000000" }, update: {},
  });
  await prisma.adminProfile.upsert({ where: { userId: admin.id }, create: { userId: admin.id }, update: {} });
  await prisma.serviceDefinition.upsert({
    where: { code: "LIMPEZA_RESIDENCIAL_COMPLETA" },
    create: { code: "LIMPEZA_RESIDENCIAL_COMPLETA", name: "Limpeza residencial completa" }, update: {},
  });
  await prisma.propertyPricingTier.upsert({
    where: { label: "Teste local — apartamento de 2 quartos" },
    create: { label: "Teste local — apartamento de 2 quartos", characteristics: { description: "Faixa de demonstração; revise antes de usar valores reais." }, priceCents: 15000, durationMinutes: 180 },
    update: {},
  });
  console.log(`Admin local criado: ${email}. Senha em LOCAL_ADMIN_PASSWORD no .env.local.`);
  console.log("Faixa de teste criada: R$ 150,00 / 180 minutos (editável no painel).");
} finally {
  await prisma.$disconnect();
}
