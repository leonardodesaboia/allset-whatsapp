import { Badge, type BadgeProps } from "@/components/ui/badge";

const STATUS_MAP: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
  // Recrutamento — funil principal
  LEAD: { label: "Lead", variant: "outline" },
  PRE_CADASTRO: { label: "Pré-cadastro", variant: "secondary" },
  TRIAGEM: { label: "Triagem", variant: "secondary" },
  CONVERSA_PENDENTE: { label: "Conv. pendente", variant: "warning" },
  ENTREVISTA: { label: "Entrevista", variant: "purple" },
  REFERENCIA: { label: "Referência", variant: "purple" },
  PRE_APROVADA: { label: "Pré-aprovada", variant: "default" },
  DOCUMENTACAO: { label: "Documentação", variant: "orange" },
  ONBOARDING: { label: "Onboarding", variant: "orange" },
  TESTE_OPERACIONAL: { label: "Teste op.", variant: "warning" },
  EM_VALIDACAO: { label: "Em validação", variant: "default" },
  ATIVA: { label: "Ativa", variant: "success" },
  PREFERENCIAL: { label: "Preferencial", variant: "success" },
  // Recrutamento — alternativos
  LIGACAO_SOLICITADA: { label: "Ligação solicitada", variant: "destructive" },
  PRECISA_DE_AJUDA: { label: "Precisa de ajuda", variant: "destructive" },
  AGUARDANDO_COMPLEMENTACAO: { label: "Aguard. compl.", variant: "warning" },
  BASE_FUTURA: { label: "Base futura", variant: "secondary" },
  REPROVADA: { label: "Reprovada", variant: "destructive" },
  DESISTIU: { label: "Desistiu", variant: "secondary" },
  PAUSADA: { label: "Pausada", variant: "secondary" },
  SUSPENSA: { label: "Suspensa", variant: "destructive" },
  // Bookings
  DRAFT: { label: "Rascunho", variant: "outline" },
  COLLECTING_DATA: { label: "Coletando dados", variant: "secondary" },
  QUOTED: { label: "Cotado", variant: "default" },
  QUOTE_ACCEPTED: { label: "Cot. aceita", variant: "default" },
  REVIEW_REQUIRED: { label: "Revisão manual", variant: "destructive" },
  AWAITING_PAYMENT: { label: "Aguard. pagto.", variant: "warning" },
  PAYMENT_FAILED: { label: "Pagto. falhou", variant: "destructive" },
  PAID: { label: "Pago", variant: "success" },
  MATCHING: { label: "Buscando prof.", variant: "purple" },
  PROFESSIONAL_ASSIGNED: { label: "Prof. designado", variant: "default" },
  SCHEDULED: { label: "Agendado", variant: "success" },
  PROFESSIONAL_CONFIRMED: { label: "Prof. confirmado", variant: "success" },
  IN_PROGRESS: { label: "Em andamento", variant: "warning" },
  COMPLETED: { label: "Concluído", variant: "success" },
  CANCELLED: { label: "Cancelado", variant: "destructive" },
  ISSUE_OPEN: { label: "Problema aberto", variant: "destructive" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const config = STATUS_MAP[status] ?? { label: status, variant: "outline" as const };
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
