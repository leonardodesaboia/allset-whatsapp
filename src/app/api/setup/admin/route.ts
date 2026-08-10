import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/infrastructure/auth/auth";
import { env } from "@/env";
import { compareSecret } from "@/infrastructure/auth/compare-secret";

// One-shot endpoint to create the first admin user.
// DELETE THIS FILE after the admin account is created.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  const authorized = compareSecret(env.INTERNAL_JOB_SECRET, token);
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password || !body?.name) {
    return NextResponse.json(
      { ok: false, error: "Campos obrigatórios: email, password, name" },
      { status: 400 }
    );
  }

  try {
    const result = await auth.api.signUpEmail({
      body: {
        name: body.name as string,
        email: body.email as string,
        password: body.password as string,
      },
    });

    return NextResponse.json({ ok: true, userId: result.user.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
