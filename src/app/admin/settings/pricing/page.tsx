import { Tag } from "lucide-react";
import { prisma } from "@/infrastructure/db/prisma-client";
import { PricingTierForm } from "./pricing-tier-form";
import { setPricingTierActiveAction } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default async function PricingSettingsPage() {
  const tiers = await prisma.propertyPricingTier.findMany({
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Preços</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          O cliente recebe estas opções ao informar as características do imóvel.
        </p>
      </div>

      <PricingTierForm />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" />
            Faixas cadastradas
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {tiers.length === 0 ? (
            <p className="text-sm text-slate-400 px-5 pb-5">Nenhuma faixa cadastrada.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Opção</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Preço</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Duração</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tiers.map((tier) => (
                  <tr key={tier.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-900">{tier.label}</p>
                      {tier.characteristics && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {typeof tier.characteristics === "string" ? tier.characteristics : JSON.stringify(tier.characteristics)}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-900 tabular-nums">
                      R$ {(tier.priceCents / 100).toFixed(2).replace(".", ",")}
                    </td>
                    <td className="px-5 py-3 text-slate-500 hidden sm:table-cell">{tier.durationMinutes} min</td>
                    <td className="px-5 py-3">
                      <Badge variant={tier.isActive ? "success" : "secondary"}>
                        {tier.isActive ? "Ativa" : "Inativa"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <form action={async () => {
                        "use server";
                        await setPricingTierActiveAction(tier.id, !tier.isActive);
                      }}>
                        <button
                          type="submit"
                          className={`text-xs font-medium ${tier.isActive ? "text-slate-500 hover:text-red-600" : "text-blue-600 hover:text-blue-800"}`}
                        >
                          {tier.isActive ? "Desativar" : "Ativar"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
