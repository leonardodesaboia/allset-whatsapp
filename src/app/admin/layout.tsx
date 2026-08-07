import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { auth } from "@/infrastructure/auth/auth";
import { SignOutButton } from "./sign-out-button";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  return (
    <div>
      <header>
        <span>AllSet Admin</span>
        <SignOutButton />
      </header>
      <main>{children}</main>
    </div>
  );
}
