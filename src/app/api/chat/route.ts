import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import {
  buildChatContext,
  chatEngines,
  chatModelLabel,
  claudeChatStream,
  geminiChat,
  openRouterChat,
  ChatError,
  type ChatEngine,
  type ChatMessage,
} from "@/lib/chat";
import { rateLimit, llmQueue } from "@/lib/rate-limit";
import { logError } from "@/lib/log";

// Chat calls an LLM and streams; adaptive thinking can take a while on hard questions.
export const maxDuration = 300;

const CHAT_LIMIT = Math.max(1, Number(process.env.CHAT_RATE_LIMIT) || 20);
const CHAT_WINDOW_MS = 60_000;

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        // Generous cap: assistant replies are echoed back as history on the next
        // turn and can be long, so this can't be the user-input limit (4000,
        // enforced client-side on the composer).
        content: z.string().trim().min(1).max(200_000),
      }),
    )
    .min(1)
    .max(24),
});

/**
 * POST /api/chat — answer a question about the user's portfolio.
 *
 * Response is a stream: the first line is a JSON meta object
 * `{"engine":"claude","model":"..."}`, everything after it is the reply text.
 * Claude streams token-by-token; OpenRouter/Gemini arrive as one chunk.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = rateLimit(`chat:${user.id}`, CHAT_LIMIT, CHAT_WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many questions in a row. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } },
    );
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid chat request." }, { status: 400 });
  }
  const messages = parsed.data.messages as ChatMessage[];
  if (messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "The last message must be from the user." }, { status: 400 });
  }

  const ladder = chatEngines();
  if (ladder.length === 0) {
    return NextResponse.json(
      {
        error:
          "AI chat needs an LLM API key (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY). AI Insights still works without one.",
      },
      { status: 503 },
    );
  }

  let context: string;
  try {
    context = await buildChatContext(user.portfolioId);
  } catch (err) {
    logError("chat-context", err, { userId: user.id });
    return NextResponse.json({ error: "Could not load your portfolio data." }, { status: 500 });
  }

  const userId = user.id;
  const encoder = new TextEncoder();
  // Aborted when the client disconnects/cancels, so LLM generation stops server-side.
  const ac = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      try {
        // Hold an llmQueue slot for the whole generation so chat bursts queue
        // instead of piling concurrent LLM calls (same policy as insights).
        await llmQueue.run(async () => {
          let lastErr: unknown = null;
          for (const engine of ladder) {
            let started = false;
            try {
              if (engine === "claude") {
                for await (const delta of claudeChatStream(context, messages, ac.signal)) {
                  if (!started) {
                    started = true;
                    send(meta(engine));
                  }
                  send(delta);
                }
                if (!started) send(meta(engine)); // empty-but-successful reply
              } else {
                const text =
                  engine === "openrouter"
                    ? await openRouterChat(context, messages, ac.signal)
                    : await geminiChat(context, messages, ac.signal);
                started = true;
                send(meta(engine) + text);
              }
              return;
            } catch (err) {
              lastErr = err;
              // Client went away — stop quietly, don't fall through to another engine.
              if (ac.signal.aborted) return;
              if (started) throw err; // partial output already sent — can't switch engines
              console.error(`Chat engine "${engine}" failed, trying next: ${String(err)}`);
            }
          }
          throw lastErr ?? new ChatError("All chat engines failed.");
        });
      } catch (err) {
        if (!ac.signal.aborted) {
          logError("chat", err, { userId });
          const msg =
            err instanceof ChatError
              ? err.message
              : "Something went wrong while answering. Please try again.";
          // If nothing was sent yet the client shows this as the error;
          // after partial output it appears as a trailing note.
          send(`\n[error] ${msg}`);
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by a client cancel */
        }
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

function meta(engine: ChatEngine): string {
  return JSON.stringify({ engine, model: chatModelLabel(engine) }) + "\n";
}
