import { RECRUITMENT_COLUMNS, recruitmentColumn } from "../../domain/recruitment/recruitment-pipeline";
import type { PrismaClient, RecruitmentLead } from "@prisma/client";
import type { RecruitmentStatus } from "../../domain/recruitment/recruitment-status";
export async function getKanbanBoard(prisma: PrismaClient) {
  const leads = await prisma.recruitmentLead.findMany({ orderBy: { updatedAt: "desc" } });
  return RECRUITMENT_COLUMNS.map((column) => ({ ...column, leads: leads.filter((lead) => recruitmentColumn(lead.status as RecruitmentStatus) === column.status) }));
}
export async function getNeedsMeLeads(prisma: PrismaClient): Promise<RecruitmentLead[]> { return prisma.recruitmentLead.findMany({ where: { OR: [{ status: "LIGACAO_SOLICITADA" }, { status: "PRECISA_DE_AJUDA" }, { status: "AGUARDANDO_COMPLEMENTACAO" }, { nextActionAt: { lt: new Date() } }] }, orderBy: { nextActionAt: "asc" } }); }
export async function searchLeads(prisma: PrismaClient, term: string): Promise<RecruitmentLead[]> { const q = term.trim(); if (!q) return []; return prisma.recruitmentLead.findMany({ where: { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { phoneE164: { contains: q, mode: "insensitive" } }, { neighborhood: { contains: q, mode: "insensitive" } }, { serviceRegions: { contains: q, mode: "insensitive" } }, { notes: { some: { content: { contains: q, mode: "insensitive" }, deletedAt: null } } }] }, take: 50, orderBy: { updatedAt: "desc" } }); }
