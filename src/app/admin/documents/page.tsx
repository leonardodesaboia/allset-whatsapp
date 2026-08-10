import Link from "next/link";
import { FileCheck, FileX, FileQuestion, ArrowRight } from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { reviewDocumentAction } from "../recruitment/actions";

const fmt = (d: Date) =>
  d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });

export default async function DocumentsPage() {
  const [pending, recentReviewed, stats] = await Promise.all([
    prisma.professionalDocument.findMany({
      where: { status: "RECEIVED" },
      orderBy: { receivedAt: "asc" },
      include: {
        lead: { select: { id: true, fullName: true, phoneE164: true } },
        requirement: { select: { name: true, required: true } },
        reviews: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.professionalDocument.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: { receivedAt: "desc" },
      take: 30,
      include: {
        lead: { select: { id: true, fullName: true } },
        requirement: { select: { name: true } },
        reviews: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.professionalDocument.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const countOf = (status: string) =>
    stats.find((s) => s.status === status)?._count._all ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Documentos</h1>
        <p className="text-sm text-slate-500 mt-0.5">Revisão centralizada de documentos recebidos</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className={pending.length > 0 ? "border-amber-200" : ""}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle as="p" className={pending.length > 0 ? "text-amber-500" : ""}>Pendentes</CardTitle>
              <FileQuestion className={`w-4 h-4 ${pending.length > 0 ? "text-amber-400" : "text-slate-400"}`} />
            </div>
            <p className={`text-3xl font-bold tabular-nums ${pending.length > 0 ? "text-amber-600" : "text-slate-900"}`}>
              {pending.length}
            </p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle as="p">Aprovados</CardTitle>
              <FileCheck className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-3xl font-bold text-slate-900 tabular-nums">{countOf("APPROVED")}</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle as="p">Rejeitados</CardTitle>
              <FileX className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-3xl font-bold text-slate-900 tabular-nums">{countOf("REJECTED")}</p>
          </CardHeader>
        </Card>
      </div>

      {/* Pendentes */}
      <Card>
        <CardHeader>
          <CardTitle as="h2" className={`flex items-center gap-1.5 ${pending.length > 0 ? "text-amber-600" : ""}`}>
            <FileQuestion className="w-3.5 h-3.5" aria-hidden />
            {pending.length > 0 ? `${pending.length} aguardando revisão` : "Nenhum documento pendente"}
          </CardTitle>
        </CardHeader>
        {pending.length > 0 && (
          <CardContent className="px-0 pb-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Profissional</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Documento</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Tamanho</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Recebido em</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pending.map((doc) => (
                  <tr key={doc.id} className="hover:bg-amber-50/40">
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/recruitment/${doc.lead.id}`}
                        className="font-semibold text-slate-900 hover:text-blue-700 leading-tight block"
                      >
                        {doc.lead.fullName ?? <span className="text-slate-400 italic">(sem nome)</span>}
                      </Link>
                      <p className="text-xs text-slate-500 mt-0.5">{doc.lead.phoneE164}</p>
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">
                        {doc.requirement.name}
                        {doc.requirement.required && <span className="ml-1 text-red-500 text-xs">*</span>}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 font-mono">{doc.contentType}</p>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500 hidden md:table-cell tabular-nums">
                      {(doc.sizeBytes / 1024).toFixed(0)} KB
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500 hidden md:table-cell">
                      {fmt(doc.receivedAt)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <form action={async () => {
                          "use server";
                          await reviewDocumentAction({ documentId: doc.id, leadId: doc.leadId, status: "APPROVED" });
                        }}>
                          <ConfirmButton
                            message={`Aprovar documento "${doc.requirement.name}" de ${doc.lead.fullName ?? doc.lead.phoneE164}?`}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                          >
                            <FileCheck className="w-3 h-3" aria-hidden />
                            Aprovar
                          </ConfirmButton>
                        </form>
                        <RejectDocumentInlineForm documentId={doc.id} leadId={doc.leadId} />
                        <Link
                          href={`/admin/recruitment/${doc.lead.id}`}
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                          title="Ver perfil"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        )}
      </Card>

      {/* Revisados recentemente */}
      {recentReviewed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle as="h2">Revisados recentemente</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Profissional</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Documento</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Decisão</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentReviewed.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/recruitment/${doc.lead.id}`}
                        className="font-semibold text-slate-900 hover:text-blue-700 text-sm"
                      >
                        {doc.lead.fullName ?? "(sem nome)"}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{doc.requirement.name}</td>
                    <td className="px-5 py-3">
                      <Badge variant={doc.status === "APPROVED" ? "success" : "destructive"}>
                        {doc.status === "APPROVED" ? "Aprovado" : "Rejeitado"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500 hidden md:table-cell">
                      {doc.reviews[0]?.reason ?? <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RejectDocumentInlineForm({ documentId, leadId }: { documentId: string; leadId: string }) {
  return (
    <form
      className="inline-flex items-center gap-1"
      action={async (data: FormData) => {
        "use server";
        const reason = data.get("reason") as string | null;
        await reviewDocumentAction({
          documentId,
          leadId,
          status: "REJECTED",
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
        });
      }}
    >
      <input
        name="reason"
        placeholder="Motivo"
        required
        className="rounded border border-slate-300 px-2 py-0.5 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-red-400"
      />
      <button
        type="submit"
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
      >
        <FileX className="w-3 h-3" />
        Rejeitar
      </button>
    </form>
  );
}
