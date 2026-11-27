import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { makeDb, makeSample, MODEL, parseJsonReply, toSampleError } from "../web/standalone";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const storage = () => new MemoryStorage() as unknown as Storage;
const nextSnap = (q: any) => new Promise<any>((resolve) => { const off = q.onSnapshot((s: any) => { off(); resolve(s); }); });

describe("parseJsonReply", () => {
  test("reads plain JSON, fenced JSON and JSON with a sentence around it", () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonReply('Here:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJsonReply('Sure. {"a":[3]} Hope that helps.')).toEqual({ a: [3] });
  });
  test("rejects replies with no JSON", () => {
    expect(() => parseJsonReply("no json here")).toThrow();
    try { parseJsonReply("nope"); } catch (e: any) { expect(e.code).toBe("invalid_json"); }
  });
});

describe("makeSample", () => {
  const fake = (reply: any, capture: any[] = []) => ({
    beta: { messages: { create: async (params: any, opts: any) => { capture.push({ params, opts }); return reply; } } },
  }) as any;

  test("sends the prompt with the default model and refusal fallback, and parses JSON", async () => {
    const calls: any[] = [];
    const s = makeSample("k", fake({ stop_reason: "end_turn", content: [{ type: "text", text: '{"ok":true}' }] }, calls));
    expect(await s.json("hello")).toEqual({ ok: true });
    expect(calls[0].params).toMatchObject({ model: MODEL, fallbacks: "default", messages: [{ role: "user", content: "hello" }] });
  });

  test("sends images before the prompt text", async () => {
    const calls: any[] = [];
    const s = makeSample("k", fake({ stop_reason: "end_turn", content: [{ type: "text", text: '{"facts":[]}' }] }, calls));
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    await s.json("read this", { images: [png] });
    const content = calls[0].params.messages[0].content;
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw==" } });
    expect(content[1]).toEqual({ type: "text", text: "read this" });
    await expect(s.json("x", { images: [new Blob(["x"], { type: "application/pdf" })] })).rejects.toMatchObject({ code: "image_rejected" });
  });

  test("maps refusals and truncation to the app's error codes", async () => {
    await expect(makeSample("k", fake({ stop_reason: "refusal", content: [] })).json("x")).rejects.toMatchObject({ code: "refused" });
    await expect(makeSample("k", fake({ stop_reason: "max_tokens", content: [] })).json("x")).rejects.toMatchObject({ code: "invalid_json" });
  });

  test("maps SDK errors", () => {
    expect(toSampleError(new Anthropic.AuthenticationError(401, undefined, "bad", new Headers())).code).toBe("bad_key");
    expect(toSampleError(new Anthropic.RateLimitError(429, undefined, "slow", new Headers())).code).toBe("rate_limited");
    expect(toSampleError(new Anthropic.APIUserAbortError()).code).toBe("cancelled");
    expect(toSampleError(new Anthropic.BadRequestError(400, undefined, "Your credit balance is too low", new Headers())).code).toBe("no_credit");
  });
});

describe("makeDb (browser storage)", () => {
  test("set, ordered snapshot, update and delete", async () => {
    const db = makeDb(storage());
    const c = db.collection("patients");
    await c.doc("a").set({ alias: "A", updated_at: "2026-01-01" });
    await c.doc("b").set({ alias: "B", updated_at: "2026-02-01" });
    let snap = await nextSnap(c.orderBy("updated_at", "desc"));
    expect(snap.docs.map((d: any) => d.id)).toEqual(["b", "a"]);
    expect(snap.metadata.fromCache).toBe(false);

    await c.doc("a").update({ alias: "A2" });
    snap = await nextSnap(c.orderBy("updated_at", "desc"));
    expect(snap.docs.find((d: any) => d.id === "a").data()).toEqual({ alias: "A2", updated_at: "2026-01-01" });

    await c.doc("b").delete();
    snap = await nextSnap(c.orderBy("updated_at"));
    expect(snap.size).toBe(1);
  });

  test("live listeners hear writes; update of a missing doc fails like the shared db", async () => {
    const db = makeDb(storage());
    const seen: number[] = [];
    const off = db.collection("boards").orderBy("created_at").onSnapshot((s: any) => seen.push(s.size));
    await new Promise((r) => queueMicrotask(() => r(null)));
    await db.collection("boards").doc("x").set({ created_at: "t" });
    off();
    expect(seen).toEqual([0, 1]);
    await expect(db.collection("boards").doc("nope").update({ a: 1 })).rejects.toMatchObject({ code: "invalid_argument" });
  });
});
