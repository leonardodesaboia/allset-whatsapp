"use client";

import { useEffect, useRef } from "react";
import { User, Bot } from "lucide-react";

export type ConversationMessage =
  | { kind: "inbound"; id: string; text: string; at: string }
  | { kind: "outbound"; id: string; text: string; at: string; status: string };

export function ConversationPanel({ messages }: { messages: ConversationMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, []);

  return (
    <div className="space-y-1 px-4 max-h-96 overflow-y-auto">
      {messages.map((msg) => (
        <div key={msg.id} className={`flex gap-2 ${msg.kind === "outbound" ? "flex-row-reverse" : ""}`}>
          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-1 ${
            msg.kind === "inbound" ? "bg-slate-200" : "bg-blue-600"
          }`}>
            {msg.kind === "inbound"
              ? <User className="w-2.5 h-2.5 text-slate-600" aria-hidden />
              : <Bot className="w-2.5 h-2.5 text-white" aria-hidden />}
          </div>
          <div className={`max-w-[75%] flex flex-col gap-0.5 ${msg.kind === "outbound" ? "items-end" : "items-start"}`}>
            <div className={`rounded-2xl px-3 py-1.5 text-sm leading-relaxed ${
              msg.kind === "inbound"
                ? "bg-slate-100 text-slate-800 rounded-tl-none"
                : "bg-blue-600 text-white rounded-tr-none"
            }`}>
              {msg.text}
            </div>
            <span className="text-[10px] text-slate-400">
              {new Date(msg.at).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Fortaleza",
              })}
              {msg.kind === "outbound" && msg.status !== "SENT" && (
                <span className="ml-1 text-red-500">({msg.status})</span>
              )}
            </span>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
