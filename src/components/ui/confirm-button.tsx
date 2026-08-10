"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ConfirmButton({
  message,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { message: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      {...props}
      className={cn(className, pending && "opacity-60 cursor-not-allowed")}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
        props.onClick?.(e);
      }}
    >
      {pending && <Loader2 className="w-3 h-3 animate-spin inline mr-1" aria-hidden />}
      {children}
    </button>
  );
}
