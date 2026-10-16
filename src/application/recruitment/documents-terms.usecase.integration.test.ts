import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { receiveProfessionalDocument, reviewProfessionalDocument } from "./documents-terms.usecase";
import { InMemoryStorageProvider } from "../../infrastructure/storage/in-memory-storage-provider";

describe("receiveProfessionalDocument", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let sequence = 0;
  let storage: InMemoryStorageProvider;

  beforeAll(async () => {
    const database = await startTestDatabase();
    prisma = database.prisma;
    stop = database.stop;
    await prisma.user.create({ data: { role: "ADMIN", email: "documents@allset.test", fullName: "Admin", phoneE164: "+5585999000000" } });
  }, 60_000);

  afterAll(async () => {
    if (stop) await stop();
  });

  async function leadAt(status: "DOCUMENTACAO" | "ONBOARDING") {
    sequence += 1;
    return prisma.recruitmentLead.create({
      data: {
        origin: "CADASTRO_MANUAL",
        status,
        fullName: `Profissional ${sequence}`,
        phoneE164: `+5585977${String(sequence).padStart(6, "0")}`,
      },
    });
  }

  async function requirement() {
    sequence += 1;
    return prisma.documentRequirement.create({
      data: {
        key: `identity-${sequence}`,
        name: "Documento de identidade",
        required: true,
      },
    });
  }

  async function pendingDocument() {
    const lead = await leadAt("DOCUMENTACAO");
    const req = await requirement();
    return prisma.professionalDocument.create({ data: {
      leadId: lead.id, requirementId: req.id, storageKey: "test/document", contentType: "image/png", sizeBytes: 3,
    } });
  }

  it("requires a rejection reason even when called outside a form", async () => {
    const document = await pendingDocument();
    const result = await reviewProfessionalDocument(prisma, { documentId: document.id, reviewer: "documents@allset.test", status: "REJECTED", reason: "  " });
    expect(result).toMatchObject({ ok: false, error: { code: "DOCUMENT_REJECTION_REASON_REQUIRED" } });
    expect((await prisma.professionalDocument.findUniqueOrThrow({ where: { id: document.id } })).status).toBe("RECEIVED");
    expect(await prisma.documentReview.count({ where: { documentId: document.id } })).toBe(0);
  });

  it("keeps only the first concurrent decision and its audit trail", async () => {
    const document = await pendingDocument();
    const results = await Promise.all([
      reviewProfessionalDocument(prisma, { documentId: document.id, reviewer: "documents@allset.test", status: "APPROVED" }),
      reviewProfessionalDocument(prisma, { documentId: document.id, reviewer: "documents@allset.test", status: "REJECTED", reason: "  Imagem ilegível  " }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, error: { code: "DOCUMENT_NOT_PENDING" } });
    const winner = results.find((result) => result.ok);
    if (!winner?.ok) throw new Error("Expected one successful decision");
    expect((await prisma.professionalDocument.findUniqueOrThrow({ where: { id: document.id } })).status).toBe(winner.value.status);
    expect(await prisma.documentReview.count({ where: { documentId: document.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: document.id, action: "PROFESSIONAL_DOCUMENT_REVIEWED" } })).toBe(1);
  });

  it("stores a trimmed rejection reason and rejects a stale second decision", async () => {
    const document = await pendingDocument();
    expect((await reviewProfessionalDocument(prisma, { documentId: document.id, reviewer: "documents@allset.test", status: "REJECTED", reason: "  Imagem ilegível  " })).ok).toBe(true);
    expect((await prisma.documentReview.findFirstOrThrow({ where: { documentId: document.id } })).reason).toBe("Imagem ilegível");
    expect(await reviewProfessionalDocument(prisma, { documentId: document.id, reviewer: "documents@allset.test", status: "APPROVED" })).toMatchObject({ ok: false, error: { code: "DOCUMENT_NOT_PENDING" } });
  });

  it("stores an admin-uploaded document and records the audit trail", async () => {
    storage = new InMemoryStorageProvider();
    const lead = await leadAt("DOCUMENTACAO");
    const req = await requirement();

    const result = await receiveProfessionalDocument(prisma, storage, {
      leadId: lead.id,
      requirementId: req.id,
      contentType: "application/pdf",
      data: new Uint8Array([1, 2, 3]),
      actor: "admin:test",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const document = await prisma.professionalDocument.findUniqueOrThrow({
      where: { id: result.value.id },
    });
    expect(document).toMatchObject({
      leadId: lead.id,
      requirementId: req.id,
      status: "RECEIVED",
      sizeBytes: 3,
    });
    expect(
      await prisma.leadEvent.count({
        where: { leadId: lead.id, type: "DOCUMENT_RECEIVED" },
      })
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: document.id,
          action: "PROFESSIONAL_DOCUMENT_RECEIVED",
        },
      })
    ).toBe(1);
    expect(await storage.get({ key: document.storageKey })).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });

  it("rejects a document when the lead is not in DOCUMENTACAO", async () => {
    storage = new InMemoryStorageProvider();
    const lead = await leadAt("ONBOARDING");
    const req = await requirement();

    const result = await receiveProfessionalDocument(prisma, storage, {
      leadId: lead.id,
      requirementId: req.id,
      contentType: "application/pdf",
      data: new Uint8Array([1]),
      actor: "admin:test",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "DOCUMENT_NOT_ALLOWED" },
    });
  });

  it("rejects an unsupported content type", async () => {
    storage = new InMemoryStorageProvider();
    const lead = await leadAt("DOCUMENTACAO");
    const req = await requirement();

    const result = await receiveProfessionalDocument(prisma, storage, {
      leadId: lead.id,
      requirementId: req.id,
      contentType: "application/zip",
      data: new Uint8Array([1]),
      actor: "admin:test",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_DOCUMENT" },
    });
  });
});
