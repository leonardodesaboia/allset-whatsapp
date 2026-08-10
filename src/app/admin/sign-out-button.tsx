"use client";

import { useRouter } from "next/navigation";
import { createAuthClient } from "better-auth/react";
import { LogOut } from "lucide-react";

const authClient = createAuthClient();

/**
 * Botão de logout do dashboard admin.
 *
 * Desvio deliberado do form HTML puro sugerido no brief: o endpoint
 * `/api/auth/sign-out` do Better Auth responde com JSON (`{ success: true }`)
 * e não redireciona, então usamos o client SDK para fazer logout e redirecionar.
 */
export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="text-slate-500 hover:text-white transition-colors"
      title="Sair"
    >
      <LogOut className="w-3.5 h-3.5" />
    </button>
  );
}
