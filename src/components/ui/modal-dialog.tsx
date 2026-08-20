"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

interface ModalDialogProps {
  ariaLabel: string;
  children: ReactNode;
  onClose: () => void;
}

/** Accessible modal shell for short, blocking admin tasks. */
export function ModalDialog({
  ariaLabel,
  children,
  onClose,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const initialFocus = dialogRef.current?.querySelector<HTMLElement>(
      "[data-autofocus], textarea, input, button, a[href]"
    );
    function focusInitialIfOutside() {
      const dialog = dialogRef.current;
      if (dialog && !dialog.contains(document.activeElement)) {
        initialFocus?.focus();
      }
    }
    // The dialog is mounted from a click handler. Deferring one frame avoids
    // the pointer activation restoring focus to the trigger after this effect.
    const focusFrame = window.requestAnimationFrame(focusInitialIfOutside);
    // App Router can finish a streamed navigation after the modal mounts and
    // move focus back to the document body without firing focusin. Recheck
    // after that hand-off, but never override focus already inside the dialog.
    const focusTimeout = window.setTimeout(focusInitialIfOutside, 500);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    function onFocusIn(event: FocusEvent) {
      const dialog = dialogRef.current;
      if (
        dialog &&
        event.target instanceof Node &&
        !dialog.contains(event.target)
      ) {
        initialFocus?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(focusTimeout);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;

    const first = focusable.item(0);
    const last = focusable.item(focusable.length - 1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={trapFocus}
    >
      {children}
    </div>
  );
}
