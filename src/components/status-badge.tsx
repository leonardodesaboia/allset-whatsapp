import { Badge, type BadgeProps } from "@/components/ui/badge";

const STATUS_MAP: Record<
  string,
  { label: string; variant: BadgeProps["variant"] }
> = {
  // Recrutamento — funil principal
  LEAD: { label: "Lead", variant: "outline" },
  PRE_CADASTRO: { label: "Em cadastro", variant: "secondary" },
  TRIAGEM: { label: "Cadastro recebido", variant: "secondary" },
  CONVERSA_PENDENTE: { label: "Em análise", variant: "warning" },
  ENTREVISTA: { label: "Entrevista", variant: "purple" },
  REFERENCIA: { label: "Referência", variant: "purple" },
  PRE_APROVADA: { label: "Pré-aprovada", variant: "default" },
  DOCUMENTACAO: { label: "Documentação", variant: "orange" },
  ONBOARDING: { label: "Onboarding", variant: "orange" },
  TESTE_OPERACIONAL: { label: "Teste op.", variant: "warning" },
  EM_VALIDACAO: { label: "Em validação", variant: "default" },
  ATIVA: { label: "Aprovada", variant: "success" },
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
  QUOTE_ACCEPTED: { label: "Horário confirmado", variant: "default" },
  REVIEW_REQUIRED: { label: "Revisão manual", variant: "destructive" },
  AWAITING_PAYMENT: { label: "Pagto. (legado)", variant: "warning" },
  PAYMENT_FAILED: { label: "Pagto. falhou", variant: "destructive" },
  PAID: { label: "Pago (legado)", variant: "success" },
  MATCHING: { label: "Buscando prof.", variant: "purple" },
  PROFESSIONAL_ASSIGNED: { label: "Prof. designado", variant: "default" },
  SCHEDULED: { label: "Agendado", variant: "success" },
  PROFESSIONAL_CONFIRMED: { label: "Prof. confirmado", variant: "success" },
  PROFESSIONAL_EN_ROUTE: { label: "Prof. a caminho", variant: "warning" },
  IN_PROGRESS: { label: "Em andamento", variant: "warning" },
  AWAITING_COMPLETION_CONFIRMATION: {
    label: "Aguard. conclusão",
    variant: "warning",
  },
  COMPLETED: { label: "Concluído", variant: "success" },
  CANCELLED: { label: "Cancelado", variant: "destructive" },
  ISSUE_OPEN: { label: "Problema aberto", variant: "destructive" },
  REFUND_PENDING: { label: "Reemb. pendente", variant: "destructive" },
  REFUNDED: { label: "Reembolsado", variant: "secondary" },
  // Conversas de clientes
  INTRODUCTION: { label: "Início", variant: "secondary" },
  NAME: { label: "Identificação", variant: "secondary" },
  PROPERTY_CHARACTERISTICS: { label: "Detalhes do serviço", variant: "secondary" },
  SCHEDULE_DATE: { label: "Data", variant: "secondary" },
  SCHEDULE_TIME: { label: "Horário", variant: "secondary" },
  QUOTE_ACCEPTANCE: { label: "Confirmação do horário", variant: "warning" },
  ADDRESS: { label: "Endereço", variant: "secondary" },
  NEIGHBORHOOD: { label: "Bairro", variant: "secondary" },
  MANUAL_REVIEW: { label: "Revisão manual", variant: "warning" },
  PAUSED: { label: "Pausada", variant: "warning" },
  FINAL_CONFIRMATION: { label: "Confirmação final", variant: "default" },
  // Oportunidades e respostas
  OPEN: { label: "Aberta", variant: "default" },
  FILLED: { label: "Preenchida", variant: "success" },
  EXPIRED: { label: "Expirada", variant: "destructive" },
  ACCEPTED: { label: "Aceita", variant: "success" },
  DECLINED: { label: "Recusada", variant: "destructive" },
  AWAITING_RESPONSE: { label: "Aguardando resposta", variant: "outline" },
};

export function statusLabel(status: string): string {
  return STATUS_MAP[status]?.label ?? status;
}

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const config = STATUS_MAP[status] ?? {
    label: status,
    variant: "outline" as const,
  };
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
