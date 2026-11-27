import Anthropic from "@anthropic-ai/sdk";
import { ClaudeOutputError } from "./claude";
import { matchPatient } from "./engine";

const PORT = Number(process.env.PORT ?? 3000);
const page = Bun.file(new URL("../public/index.html", import.meta.url));

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

/** Maps failures to a message a non-technical user can act on. Never leaks stack traces. */
export function errorResponse(err: unknown): Response {
  if (err instanceof RangeError) return json({ error: err.message }, 400);
  if (err instanceof Anthropic.AuthenticationError) {
    return json({ error: "The Claude API key is missing or invalid. Set ANTHROPIC_API_KEY and restart." }, 503);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return json({ error: "Too many requests to Claude right now. Wait a minute and try again." }, 429);
  }
  if (err instanceof Anthropic.APIError) {
    return json({ error: `Claude API error (${err.status ?? "network"}). Try again.` }, 502);
  }
  if (err instanceof ClaudeOutputError) return json({ error: err.message }, 502);
  if (err instanceof Error && /ANTHROPIC_API_KEY|apiKey|authToken/i.test(err.message)) {
    return json({ error: "No Claude API key is configured. Set ANTHROPIC_API_KEY and restart." }, 503);
  }
  if (err instanceof Error && err.message.startsWith("ClinicalTrials.gov")) {
    return json({ error: "Could not reach ClinicalTrials.gov. Try again shortly." }, 502);
  }
  console.error(err);
  return json({ error: "Something went wrong. Try again." }, 500);
}

export async function handle(req: Request, run = matchPatient, makeClient = getClient): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/") {
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (req.method === "POST" && url.pathname === "/api/match") {
    let text: unknown;
    try {
      text = ((await req.json()) as { text?: unknown }).text;
    } catch {
      return json({ error: "Send JSON like {\"text\": \"...\"}." }, 400);
    }
    if (typeof text !== "string") return json({ error: "Send JSON like {\"text\": \"...\"}." }, 400);
    try {
      return json(await run(text, { client: makeClient() }));
    } catch (err) {
      return errorResponse(err);
    }
  }
  return json({ error: "Not found" }, 404);
}

if (import.meta.main) {
  Bun.serve({ port: PORT, fetch: (req) => handle(req), idleTimeout: 255 });
  console.log(`Trial matcher running at http://localhost:${PORT}`);
}
