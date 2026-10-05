import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { createLeadUseCase } from "./create-lead.usecase";
import { transitionLeadStatusUseCase } from "./transition-lead-status.usecase";
import { addLeadNote, deleteLeadNote, editLeadNote } from "./lead-notes.usecase";
import { completeReminder, createReminder, setNextAction } from "./lead-next-action.usecase";
import { getKanbanBoard, getNeedsMeLeads, searchLeads } from "./kanban-read-model";

describe("recruitment use cases", () => {
  let prisma: PrismaClient; let stop: (() => Promise<void>) | undefined;
  beforeAll(async () => { const database = await startTestDatabase(); prisma = database.prisma; stop = database.stop; }, 60_000);
  afterAll(async () => { if (stop) await stop(); });
  async function lead(name = "Maria de Sousa") { const result = await createLeadUseCase(prisma, { actor: "admin:test", origin: "CADASTRO_MANUAL", fullName: name, phoneE164: `+5585${Date.now()}${Math.floor(Math.random() * 1000)}`, neighborhood: "Aldeota" }); if (!result.ok) throw result.error; return result.value; }
  it("cria lead com evento e auditoria", async () => { const created = await lead(); expect(created.status).toBe("LEAD"); expect(await prisma.leadEvent.count({ where: { leadId: created.id, type: "LEAD_CREATED" } })).toBe(1); expect(await prisma.auditLog.count({ where: { entityId: created.id, action: "LEAD_CREATED" } })).toBe(1); });
  it("faz transição auditada e promove para profissional", async () => { const created = await lead(); await prisma.recruitmentLead.update({ where: { id: created.id }, data: { status: "EM_VALIDACAO" } }); await prisma.validationPolicy.create({ data: { requiredServices: 1 } }); await prisma.validationServiceRecord.create({ data: { leadId: created.id, externalServiceId: `service:${created.id}`, hadIssue: false } }); const moved = await transitionLeadStatusUseCase(prisma, { leadId: created.id, targetStatus: "ATIVA", actor: "admin:test" }); expect(moved.ok).toBe(true); const updated = await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: created.id } }); expect(updated.professionalProfileId).not.toBeNull(); expect(await prisma.recruitmentStatusHistory.count({ where: { leadId: created.id } })).toBe(1); });
  it("registra revisão e exclusão lógica de nota", async () => { const created = await lead(); const note = await addLeadNote(prisma, { leadId: created.id, author: "admin:test", content: "v1" }); if (!note.ok) throw note.error; await editLeadNote(prisma, { noteId: note.value.id, editedBy: "admin:test", content: "v2" }); await deleteLeadNote(prisma, { noteId: note.value.id, actor: "admin:test" }); expect(await prisma.leadNoteRevision.count({ where: { noteId: note.value.id } })).toBe(1); expect((await prisma.leadNote.findUniqueOrThrow({ where: { id: note.value.id } })).deletedAt).not.toBeNull(); });
  it("mantém ações, lembretes e consultas do kanban", async () => { const created = await lead("Fernanda Lima"); await setNextAction(prisma, { leadId: created.id, actor: "admin:test", nextAction: "Ligar", nextActionAt: new Date(Date.now() - 1) }); const reminder = await createReminder(prisma, { leadId: created.id, createdBy: "admin:test", text: "Retornar", dueAt: new Date() }); if (!reminder.ok) throw reminder.error; await completeReminder(prisma, { reminderId: reminder.value.id }); expect((await getKanbanBoard(prisma)).find((column) => column.status === "LEAD")?.leads.some((item) => item.id === created.id)).toBe(true); expect((await getNeedsMeLeads(prisma)).some((item) => item.id === created.id)).toBe(true); expect((await searchLeads(prisma, "fernanda")).some((item) => item.id === created.id)).toBe(true); });
  it("mantém no Kanban as filas que exigem ação humana ou encerramento", async () => {
    const paused = await lead("Profissional pausada");
    await prisma.recruitmentLead.update({ where: { id: paused.id }, data: { status: "PAUSADA" } });

    const board = await getKanbanBoard(prisma);
    expect(board.find((column) => column.status === "PAUSADA")?.leads.some((item) => item.id === paused.id)).toBe(true);
    expect(board.map((column) => column.status)).toEqual(expect.arrayContaining(["PREFERENCIAL", "PRECISA_DE_AJUDA", "AGUARDANDO_COMPLEMENTACAO", "REPROVADA", "DESISTIU", "SUSPENSA"]));
  });
});
