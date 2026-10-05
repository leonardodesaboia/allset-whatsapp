import type { LeadNote, LeadNoteType, PrismaClient } from "@prisma/client";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export async function addLeadNote(prisma: PrismaClient, input: { leadId: string; author: string; content: string; type?: LeadNoteType; pinned?: boolean }): Promise<Result<LeadNote, DomainError>> {
  if (!input.content.trim()) return err(new DomainError("Nota não pode ser vazia", "NOTE_CONTENT_REQUIRED"));
  return prisma.$transaction(async (tx) => { const note = await tx.leadNote.create({ data: { leadId: input.leadId, author: input.author, content: input.content, ...(input.type ? { type: input.type } : {}), ...(input.pinned !== undefined ? { pinned: input.pinned } : {}) } }); await tx.leadEvent.create({ data: { leadId: input.leadId, type: "NOTE_ADDED", description: "Nota adicionada", actor: input.author } }); return ok(note); });
}
export async function editLeadNote(prisma: PrismaClient, input: { noteId: string; editedBy: string; content: string }): Promise<Result<LeadNote, DomainError>> {
  if (!input.content.trim()) return err(new DomainError("Nota não pode ser vazia", "NOTE_CONTENT_REQUIRED"));
  return prisma.$transaction(async (tx) => { const note = await tx.leadNote.findUnique({ where: { id: input.noteId } }); if (!note) return err(new DomainError("Nota não encontrada", "NOTE_NOT_FOUND")); if (note.deletedAt) return err(new DomainError("Nota excluída", "NOTE_DELETED")); await tx.leadNoteRevision.create({ data: { noteId: note.id, previousContent: note.content, editedBy: input.editedBy } }); return ok(await tx.leadNote.update({ where: { id: note.id }, data: { content: input.content, editedAt: new Date() } })); });
}
export async function deleteLeadNote(prisma: PrismaClient, input: { noteId: string; actor: string }): Promise<Result<LeadNote, DomainError>> { return prisma.$transaction(async (tx) => { const existing = await tx.leadNote.findUnique({ where: { id: input.noteId } }); if (!existing) return err(new DomainError("Nota não encontrada", "NOTE_NOT_FOUND")); if (existing.deletedAt) return ok(existing); const note = await tx.leadNote.update({ where: { id: input.noteId }, data: { deletedAt: new Date() } }); await recordAuditLog(tx, { actor: input.actor, action: "LEAD_NOTE_DELETED", entityType: "LeadNote", entityId: note.id }); return ok(note); }); }
