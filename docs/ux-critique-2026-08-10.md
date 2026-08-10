# UX Critique — AllSet Admin Panel
**Data:** 2026-08-10 · **Score:** 18/40 (Poor) · **Método:** dual-agent impeccable

---

## Heurísticas Nielsen

| # | Heurística | Nota | Problema principal |
|---|-----------|------|--------------------|
| 1 | Visibilidade do status | 2 | Sem feedback de loading em Server Actions; sem timestamp nos dados do dashboard |
| 2 | Correspondência com o mundo real | 2 | 9/13 estágios do funil com ícone Clock idêntico; "Dead letters" em inglês; enums em inglês nas badges |
| 3 | Controle e liberdade | 1 | Zero diálogos de confirmação; "Descartar" executa no primeiro clique; sem undo em nenhuma ação |
| 4 | Consistência | 3 | Tokens CVA uniformes; drift menor: Aprovar/Rejeitar usa `<button>` bare, não o componente `Button` |
| 5 | Prevenção de erros | 1 | Aprovar e Rejeitar são botões adjacentes sem confirmação; campo de motivo é 36px inline ao lado do botão de aprovação |
| 6 | Reconhecimento vs. memorização | 2 | Kanban exige conhecer todos os 13 estágios de antemão; sem legenda ou tooltip nos estágios |
| 7 | Flexibilidade e eficiência | 2 | Drag-and-drop existe; sem atalhos de teclado; sem aprovação em lote de documentos |
| 8 | Design estético e minimalista | 3 | Limpo no geral; perfil do lead mostra 6+ cards vazios para leads em estágio inicial |
| 9 | Recuperação de erros | 2 | Erro do Kanban bem posicionado; falhas de Server Action são silenciosas; "dead letter" não explicado |
| 10 | Ajuda e documentação | 0 | Nada — sem tooltips, sem glossário de estágios, sem dicas contextuais |
| **Total** | | **18/40** | **Poor** |

---

## Problemas Prioritários

### P0 — Sem confirmação em ações destrutivas
- **O quê:** "Aprovar", "Rejeitar" e "Descartar permanentemente" executam no primeiro clique, sem modal de confirmação e sem undo
- **Por que importa:** Aprovação de documento é irreversível. "Descartar" apaga a mensagem. Os botões Aprovar e Rejeitar ficam lado a lado na mesma linha da tabela — um misclick aprova o que deveria rejeitar
- **Fix:** Confirmação via `window.confirm` ou modal antes das ações destrutivas; toast com undo de 5s nas transições de status
- **Arquivo:** `src/app/admin/outbox/page.tsx`, `src/app/admin/documents/page.tsx`, `src/app/admin/recruitment/[leadId]/page.tsx`

### P1 — Perfil do lead renderiza todos os cards independente do estágio
- **O quê:** Um lead em TRIAGEM ainda vê cards vazios de Documentação, Onboarding, Teste operacional e Validação — 5+ seções irrelevantes antes da ação ativa
- **Por que importa:** O operador precisa rolar ~400–600px para alcançar a seção relevante; multiplica o tempo de triagem em cada lead
- **Fix:** Renderizar apenas seções ≤ estágio atual do lead; estágios futuros ocultos; histórico colapsado em "Ver histórico"
- **Arquivo:** `src/app/admin/recruitment/[leadId]/page.tsx`

### P1 — Server Actions sem feedback de loading ou sucesso
- **O quê:** Ao clicar em qualquer botão de ação, a UI fica silenciosa até o round-trip do servidor completar e a página recarregar
- **Por que importa:** Sob qualquer latência, o operador não sabe se a ação registrou — o instinto é clicar de novo, gerando double-submit
- **Fix:** `useFormStatus` para desabilitar o botão e mostrar spinner; toast de sucesso/erro após a ação
- **Arquivos:** formulários nas páginas de documentos, outbox e perfil do lead

### P2 — Conversa WhatsApp é o último card do perfil
- **O quê:** O histórico de mensagens fica após 8+ cards (Entrevistas, Avaliações, Referências, Docs, Onboarding, Teste, Validação, Notas)
- **Por que importa:** Para um produto WhatsApp-first, a conversa é o contexto operacional mais importante — mas está enterrada no fundo
- **Fix:** Mover "Conversa WhatsApp" para segunda posição (após o alerta de próxima ação); adicionar scroll-to-bottom automático ao carregar
- **Arquivo:** `src/app/admin/recruitment/[leadId]/page.tsx`

### P3 — Kanban de 13 colunas requer 2600px de largura
- **O quê:** Colunas com `min-w-[200px]` fixo; em 1440px com sidebar de 224px, apenas ~6 colunas são visíveis sem scroll horizontal
- **Por que importa:** O operador não consegue ver a coluna de destino ao arrastar um lead — tem de rolar para encontrar e depois voltar
- **Fix:** Board em dois níveis (funil ativo vs. estágios tardios) ou colunas colapsáveis com contador
- **Arquivo:** `src/app/admin/recruitment/kanban-board.tsx`

---

## Acessibilidade (Persona Sam)

- **Hierarquia de headings quebrada:** `h1` → `h3` nas cards do dashboard, pulando `h2`
- **Botão Trash2 sem label acessível:** usa apenas atributo `title`, que leitores de tela não garantem anunciar
- **Kanban DnD sem alternativa de teclado:** arrastar requer ponteiro; não há como mover leads via teclado
- **Inputs sem `<label>`:** `RejectDocumentForm` e outros usam apenas `placeholder` como descrição do campo

---

## Observações Menores

- "Dead letters" é termo em inglês em uma UI em português, sem explicação
- 9 de 13 estágios no dashboard compartilham o ícone Clock — sem diferenciação visual
- Badges de status de referência mostram enums em inglês (`CONFIRMED`, `NEGATIVE`) — UI é em português
- Conversa WhatsApp não rola automaticamente para o final ao carregar
- Fundo da tela de login (`slate-950`) contrasta com o painel admin (`slate-50`) — transição visual abrupta
- Inter atribuída via variável CSS (`--font-sans`) — detector não detecta; oportunidade de diferenciação tipográfica perdida

---

## Questões para Considerar

1. **E se o perfil do lead fosse um cockpit, não um arquivo?** Mostrar apenas "o que preciso fazer agora e qual contexto preciso" — estágio atual determina quais seções são primárias, quais colapsadas e quais ocultas
2. **Kanban é a view certa para 13 estágios?** Uma lista priorizada (por urgência e progresso no funil) pode ser mais acionável que 13 colunas
3. **O que seria o WhatsApp como elemento de design de primeira classe?** Operador responde direto do card do Kanban, sem abrir o perfil completo
