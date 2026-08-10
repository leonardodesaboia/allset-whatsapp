# ADR 0003: `@dnd-kit` para drag-and-drop do Kanban de profissionais

**Data:** 2026-08-07  
**Status:** Aceito

## Contexto

O Kanban do funil de recrutamento exige drag-and-drop entre colunas com
validação de transição e suporte a teclado. As bibliotecas de UI atuais não
cobrem esse comportamento.

## Decisão

Adotar `@dnd-kit/core` e `@dnd-kit/sortable` na camada de apresentação.

## Alternativas descartadas

- `react-beautiful-dnd`: sem manutenção ativa e com incompatibilidades com React 19.
- HTML5 Drag and Drop nativo: acessibilidade insuficiente e suporte a teclado difícil.

## Consequências

- Há uma dependência adicional limitada à UI.
- Cada cartão também deve oferecer mover-via-menu para que DnD não seja o único caminho.
