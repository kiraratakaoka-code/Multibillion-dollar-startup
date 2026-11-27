/**
 * Standalone mode for the Eligo web app (GitHub Pages or any static host, outside Claude).
 * Inside Claude the app uses the viewer's Claude account and a shared database.
 * Here it uses the person's own Anthropic API key and stores data in this browser.
 *
 * Bundled for the browser by scripts/build-site.ts into docs/standalone.js.
 */
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
// Storage keys keep the original "puente:" prefix so API keys and data saved before the rename still load.
const KEY_STORAGE = "puente:anthropic-key";
const DB_PREFIX = "puente:db:";

/** Error shape the app already understands (same codes as Claude's in-app sampling). */
export interface SampleError { code: string; message: string }

/** Reads one JSON value out of a model reply: the whole text, a ``` fence, or the outermost {...}/[...]. */
export function parseJsonReply(text: string): unknown {
  const tries: string[] = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1]!.trim());
  const start = text.search(/[\[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start >= 0 && end > start) tries.push(text.slice(start, end + 1));
  for (const t of tries) {
    try { return JSON.parse(t); } catch { /* try the next form */ }
  }
  throw { code: "invalid_json", message: "The reply held no JSON value." } satisfies SampleError;
}

type Client = Pick<Anthropic, "beta">;

/** A `sample` with the same `.json(prompt, {signal})` call the app uses inside Claude. */
export function makeSample(apiKey: string, client: Client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })) {
  async function json(prompt: string, opts: { signal?: AbortSignal } = {}): Promise<unknown> {
    let res;
    try {
      res = await client.beta.messages.create(
        {
          model: MODEL,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          // If a safety classifier declines, the API retries on a suitable fallback model in the same call.
          fallbacks: "default",
          messages: [{ role: "user", content: prompt }],
        },
        { signal: opts.signal },
      );
    } catch (e) {
      throw toSampleError(e);
    }
    if (res.stop_reason === "refusal") throw { code: "refused", message: "Claude declined this request." } satisfies SampleError;
    if (res.stop_reason === "max_tokens") throw { code: "invalid_json", message: "The reply was cut off." } satisfies SampleError;
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return parseJsonReply(text);
  }
  return { json };
}

export function toSampleError(e: unknown): SampleError {
  if (e instanceof Anthropic.APIUserAbortError) return { code: "cancelled", message: "Stopped." };
  if (e instanceof Anthropic.AuthenticationError) return { code: "bad_key", message: "The API key was rejected." };
  if (e instanceof Anthropic.PermissionDeniedError) return { code: "bad_key", message: "The API key can't use this model." };
  if (e instanceof Anthropic.RateLimitError) return { code: "rate_limited", message: "Rate limited." };
  if (e instanceof Anthropic.BadRequestError && /credit|balance/i.test(e.message)) return { code: "no_credit", message: e.message };
  if (e instanceof Anthropic.APIError) return { code: "upstream_error", message: e.message };
  return { code: "upstream_error", message: String((e as Error)?.message ?? e) };
}

/* ---------------- API key ---------------- */
export function getKey(storage: Storage = localStorage): string {
  try { return storage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
}
export function setKey(key: string, storage: Storage = localStorage): void {
  try { key ? storage.setItem(KEY_STORAGE, key.trim()) : storage.removeItem(KEY_STORAGE); } catch { /* storage blocked */ }
}

/* ---------------- browser-local database ----------------
 * The same small surface the app uses from Claude's shared db:
 *   db.collection(c).orderBy(field, dir).onSnapshot(next, error)
 *   db.collection(c).doc(id).set(body) / .update(patch) / .delete()
 */
type Doc = Record<string, unknown>;
type Listener = { field?: string; dir: "asc" | "desc"; next: (snap: any) => void };

export function makeDb(storage: Storage = localStorage) {
  const listeners = new Map<string, Set<Listener>>();
  const read = (c: string): Record<string, Doc> => {
    try { return JSON.parse(storage.getItem(DB_PREFIX + c) || "{}"); } catch { return {}; }
  };
  const write = (c: string, all: Record<string, Doc>) => {
    try { storage.setItem(DB_PREFIX + c, JSON.stringify(all)); }
    catch { throw { code: "quota_exceeded", message: "Browser storage is full." }; }
    notify(c);
  };
  const snapshot = (c: string, l: Listener) => {
    const docs = Object.entries(read(c)).map(([id, body]) => ({ id, exists: true, data: () => body, metadata: { fromCache: false, hasPendingWrites: false } }));
    if (l.field) {
      const f = l.field, sign = l.dir === "desc" ? -1 : 1;
      docs.sort((a, b) => {
        const x = a.data()[f] as any, y = b.data()[f] as any;
        if (x == null) return 1; if (y == null) return -1;
        return x < y ? -sign : x > y ? sign : 0;
      });
    }
    return { docs, size: docs.length, empty: docs.length === 0, metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const notify = (c: string) => { for (const l of listeners.get(c) ?? []) l.next(snapshot(c, l)); };
  // Another tab of the app changed the data.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => { if (e.key?.startsWith(DB_PREFIX)) notify(e.key.slice(DB_PREFIX.length)); });
  }

  function query(c: string, field?: string, dir: "asc" | "desc" = "asc") {
    return {
      orderBy: (f: string, d: "asc" | "desc" = "asc") => query(c, f, d),
      onSnapshot(next: (snap: any) => void, _error?: (e: unknown) => void) {
        const l: Listener = { field, dir, next };
        if (!listeners.has(c)) listeners.set(c, new Set());
        listeners.get(c)!.add(l);
        queueMicrotask(() => next(snapshot(c, l)));
        return () => listeners.get(c)!.delete(l);
      },
    };
  }
  function collection(c: string) {
    return {
      ...query(c),
      doc: (id: string) => ({
        id,
        async set(body: Doc) { const all = read(c); all[id] = structuredClone(body); write(c, all); },
        async update(patch: Doc) {
          const all = read(c);
          if (!all[id]) throw { code: "invalid_argument", message: "Document does not exist." };
          all[id] = { ...all[id], ...structuredClone(patch) };
          write(c, all);
        },
        async delete() { const all = read(c); delete all[id]; write(c, all); },
      }),
    };
  }
  return { collection };
}

/* ---------------- the person using this browser ---------------- */
const AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0b6b57"/><text x="16" y="21" font-family="sans-serif" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">Y</text></svg>');
export function makeUser() {
  const me = { id: "local", name: "You", avatarUrl: AVATAR, color: "#0b6b57", email: null, isOwner: true, canEdit: true };
  return {
    me: async () => me,
    can: async () => true,
    profiles: async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, id === "local" ? { ...me, isMe: true, guest: false, roles: null } : { id, name: "", avatarUrl: AVATAR, color: "#888", email: null, isMe: false, guest: false, roles: null }])),
  };
}

// Exposed for the page's plain <script>.
if (typeof window !== "undefined") {
  (window as any).EligoStandalone = { makeSample, makeDb, makeUser, getKey, setKey, MODEL };
}
