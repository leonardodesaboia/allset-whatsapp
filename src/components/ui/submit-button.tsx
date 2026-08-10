"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { cn } from "@/lib/utils";

/** Drop-in replacement for `<Button type="submit">` with built-in useFormStatus loading state. */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  variant,
  size,
  ...props
}: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      variant={variant}
      size={size}
      className={className}
      {...props}
    >
      {pending && <Loader2 className="w-3 h-3 animate-spin" aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

/** Bare submit button (no Button component styling) with useFormStatus. */
export function SubmitButtonRaw({
  children,
  pendingLabel,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      {...props}
      className={cn(className, pending && "opacity-60 cursor-not-allowed")}
    >
      {pending && <Loader2 className="w-3 h-3 animate-spin inline mr-1" aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
