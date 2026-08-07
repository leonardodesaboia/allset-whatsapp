import { getKanbanBoard } from "@/application/recruitment/kanban-read-model";
import { prisma } from "@/infrastructure/db/prisma-client";
import { KanbanBoard } from "./kanban-board";
import { NewLeadForm } from "./new-lead-form";
export default async function RecruitmentPage() { const board = await getKanbanBoard(prisma); return <section><h1>Profissionais — Funil</h1><NewLeadForm /><KanbanBoard columns={board.map((column) => ({ status: column.status, label: column.label, leads: column.leads.map((lead) => ({ id: lead.id, fullName: lead.fullName, neighborhood: lead.neighborhood, origin: lead.origin, nextAction: lead.nextAction, nextActionAt: lead.nextActionAt?.toISOString() ?? null, preferredCommunicationMode: lead.preferredCommunicationMode })) }))} /></section>; }
