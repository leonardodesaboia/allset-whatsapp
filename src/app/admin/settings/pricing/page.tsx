import { prisma } from "@/infrastructure/db/prisma-client";
import { PricingTierForm } from "./pricing-tier-form";
import { setPricingTierActiveAction } from "./actions";

export default async function PricingSettingsPage() {
  const tiers = await prisma.propertyPricingTier.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
  return <section>
    <h1>Faixas de preço</h1>
    <p>O cliente recebe estas opções numeradas ao informar as características do imóvel.</p>
    <PricingTierForm />
    <h2>Faixas cadastradas</h2>
    {tiers.length === 0 ? <p>Nenhuma faixa cadastrada.</p> : <table>
      <thead><tr><th>Opção</th><th>Preço</th><th>Duração</th><th>Status</th><th>Ação</th></tr></thead>
      <tbody>{tiers.map((tier) => <tr key={tier.id}>
        <td>{tier.label}</td>
        <td>R$ {(tier.priceCents / 100).toFixed(2).replace(".", ",")}</td>
        <td>{tier.durationMinutes} min</td>
        <td>{tier.isActive ? "Ativa" : "Inativa"}</td>
        <td><form action={async () => { "use server"; await setPricingTierActiveAction(tier.id, !tier.isActive); }}><button type="submit">{tier.isActive ? "Desativar" : "Ativar"}</button></form></td>
      </tr>)}</tbody>
    </table>}
  </section>;
}
