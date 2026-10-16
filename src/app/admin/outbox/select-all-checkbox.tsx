"use client";

/** Marca/desmarca todas as caixas de seleção de mensagens associadas ao formulário em lote. */
export function SelectAllCheckbox({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Selecionar todas as mensagens"
      className="h-4 w-4"
      onChange={(event) => {
        const boxes = document.querySelectorAll<HTMLInputElement>(
          `input[name="ids"][form="${formId}"]`
        );
        boxes.forEach((box) => {
          box.checked = event.currentTarget.checked;
        });
      }}
    />
  );
}
