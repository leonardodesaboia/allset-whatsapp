import { z } from "zod";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";
import { createRuntimeStorage } from "@/infrastructure/storage/storage-runtime";
import { logger } from "@/infrastructure/observability/logger";

export const runtime = "nodejs";

const extensions: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf",
};

/** Documents remain private even when this URL is opened outside the admin layout. */
export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.email) return new Response("Sessão necessária.", { status: 401 });
  const admin = await prisma.user.findFirst({ where: { email: session.user.email, role: "ADMIN" }, select: { id: true } });
  if (!admin) return new Response("Acesso administrativo necessário.", { status: 403 });
  const { documentId } = await context.params;
  if (!z.string().uuid().safeParse(documentId).success) return new Response("Documento não encontrado.", { status: 404 });
  const document = await prisma.professionalDocument.findUnique({ where: { id: documentId } });
  const extension = document && extensions[document.contentType];
  if (!document || !extension) return new Response("Documento não encontrado.", { status: 404 });
  try {
    const data = await createRuntimeStorage().get({ key: document.storageKey });
    return new Response(new Uint8Array(data), { headers: {
      "Content-Type": document.contentType,
      "Content-Disposition": `inline; filename="documento.${extension}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    logger.error({ err: error, documentId }, "Falha ao abrir documento profissional");
    return new Response("Não foi possível abrir o arquivo. Tente novamente ou confira o armazenamento.", { status: 503 });
  }
}
