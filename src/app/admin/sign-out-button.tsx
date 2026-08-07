"use client";

import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient();

/**
 * Botão de logout do dashboard admin.
 *
 * Desvio deliberado do form HTML puro sugerido no brief: o endpoint
 * `/api/auth/sign-out` do Better Auth responde com JSON (`{ success: true }`)
 * e não redireciona (ver `node_modules/better-auth/dist/api/routes/sign-out.mjs`),
 * então um `<form method="post">` navegaria o browser para a resposta JSON
 * do endpoint em vez de voltar para `/login`. Usamos o mesmo padrão de
 * client component já estabelecido em `src/app/login/page.tsx` (Task 8).
 */
export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <button type="button" onClick={handleSignOut}>
      Sair
    </button>
  );
}
