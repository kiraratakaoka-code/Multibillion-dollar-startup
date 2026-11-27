import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { ClaudeOutputError } from "../src/claude";
import { handle } from "../src/server";

const post = (body: string) =>
  new Request("http://x/api/match", { method: "POST", body, headers: { "content-type": "application/json" } });
const noClient = () => ({}) as any;

describe("server", () => {
  test("serves the page", async () => {
    const res = await handle(new Request("http://x/"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Trial Matcher");
  });

  test("rejects bad request bodies", async () => {
    expect((await handle(post("not json"), undefined, noClient)).status).toBe(400);
    expect((await handle(post('{"text": 5}'), undefined, noClient)).status).toBe(400);
  });

  test("returns the engine's result", async () => {
    const run = async (text: string) => ({ status: "not_a_cancer_case", echo: text }) as any;
    const res = await handle(post('{"text":"hi"}'), run, noClient);
    expect(await res.json()).toEqual({ status: "not_a_cancer_case", echo: "hi" });
  });

  test("maps failures to actionable messages", async () => {
    const cases: [unknown, number][] = [
      [new RangeError("too long"), 400],
      [new Anthropic.AuthenticationError(401, undefined, "bad key", new Headers()), 503],
      [new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()), 429],
      [new ClaudeOutputError("declined"), 502],
      [new Error("ClinicalTrials.gov returned 500 for ..."), 502],
    ];
    for (const [err, status] of cases) {
      const res = await handle(post('{"text":"x"}'), async () => { throw err; }, noClient);
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBeString();
    }
  });

  test("unknown routes are 404", async () => {
    expect((await handle(new Request("http://x/nope"))).status).toBe(404);
  });
});
