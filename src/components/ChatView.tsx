"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Sparkles, Square } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const ENGINE_LABEL: Record<string, string> = {
  claude: "Claude",
  openrouter: "OpenRouter",
  gemini: "Gemini",
};

const SUGGESTIONS = [
  "Where is my portfolio most concentrated?",
  "What could I consider adding to diversify?",
  "Which of my holdings look risky right now?",
  "How are my mutual funds doing compared to my stocks?",
];

// History slice sent to the API (the server also caps at 24).
const MAX_SENT_MESSAGES = 16;

export default function ChatView({
  hasHoldings,
  llmAvailable,
}: {
  hasHoldings: boolean;
  llmAvailable: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setInput("");
    setBusy(true);

    const history = [...messages, { role: "user" as const, content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-MAX_SENT_MESSAGES) }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "The assistant could not answer. Please try again.");
      }

      // Protocol: first line is JSON meta ({engine, model}), the rest is the reply.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let metaParsed = false;

      const applyText = (text: string) =>
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: text };
          return next;
        });

      let reply = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (!metaParsed) {
          const nl = buffer.indexOf("\n");
          if (nl === -1) continue;
          try {
            const m = JSON.parse(buffer.slice(0, nl));
            setEngine(ENGINE_LABEL[m.engine] ?? m.engine);
          } catch {
            /* no meta line — treat everything as text */
          }
          buffer = buffer.slice(nl + 1);
          metaParsed = true;
        }
        reply = buffer;
        applyText(reply);
      }

      // A trailing "[error] ..." marker means the server failed mid-stream.
      const errIdx = reply.lastIndexOf("\n[error] ");
      if (errIdx !== -1 || reply.startsWith("[error] ")) {
        const clean = errIdx === -1 ? "" : reply.slice(0, errIdx);
        const msg = (errIdx === -1 ? reply.slice(8) : reply.slice(errIdx + 9)).trim();
        if (clean.trim()) {
          applyText(clean.trimEnd());
          setError(msg);
        } else {
          setMessages((prev) => prev.slice(0, -1));
          setError(msg);
        }
      } else if (!reply.trim()) {
        setMessages((prev) => prev.slice(0, -1));
        setError("The assistant returned an empty reply. Please try again.");
      }
    } catch (err) {
      // Drop a trailing empty assistant bubble (nothing streamed before the failure/stop).
      setMessages((prev) => (prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev));
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Ask AI</h1>
          <p className="mt-0.5 text-sm text-muted">
            Chat with an assistant that sees your live portfolio — holdings, funds, allocation, and concentration.
          </p>
        </div>
        {engine && (
          <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs text-accent">
            {engine}
          </span>
        )}
      </div>

      {!llmAvailable ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-16 text-center">
          <Sparkles className="mx-auto h-10 w-10 text-muted" />
          <h2 className="mt-4 text-lg font-bold">AI chat needs an API key</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Set ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY in the server environment to enable
            portfolio chat. AI Insights still works without a key.
          </p>
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface p-4">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
                <div>
                  <MessageCircle className="mx-auto h-10 w-10 text-muted" />
                  <p className="mx-auto mt-3 max-w-md text-sm text-muted">
                    {hasHoldings
                      ? "Ask anything about your portfolio — the assistant answers from your actual numbers."
                      : "You haven't imported holdings yet, so answers will be general. Import a portfolio for grounded analysis."}
                  </p>
                </div>
                <div className="flex max-w-xl flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => ask(s)}
                      className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted hover:text-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-sm bg-accent/15 px-4 py-2.5 text-sm"
                        : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-border bg-surface-2 px-4 py-2.5 text-sm leading-relaxed"
                    }
                  >
                    {m.content ||
                      (busy && i === messages.length - 1 ? (
                        <span className="inline-flex gap-1 text-muted">
                          <span className="animate-pulse">Thinking</span>
                          <span className="animate-bounce">…</span>
                        </span>
                      ) : (
                        m.content
                      ))}
                  </div>
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          {error && (
            <p className="rounded-xl border border-loss/40 bg-loss/10 px-4 py-2.5 text-sm text-loss">{error}</p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your portfolio…"
              maxLength={4000}
              className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none placeholder:text-muted focus:border-accent/60"
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm font-semibold hover:text-ink"
              >
                <Square className="h-4 w-4" /> Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex items-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-40"
              >
                <Send className="h-4 w-4" /> Ask
              </button>
            )}
          </form>

          <p className="text-center text-xs text-muted">
            AI-generated analysis, not investment advice. Verify before acting; consult a SEBI-registered advisor.
          </p>
        </>
      )}
    </div>
  );
}
