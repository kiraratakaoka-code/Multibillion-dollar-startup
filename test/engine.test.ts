import { describe, expect, test } from "bun:test";
import { ClaudeOutputError, MODEL } from "../src/claude";
import { matchPatient, MAX_INPUT_CHARS } from "../src/engine";
import { assessFeasibility, regionOf } from "../src/feasibility";
import { fakeClaude, makeCase, makeTrial } from "./helpers";

const study = (id: string, countries: string[]) => ({
  protocolSection: {
    identificationModule: { nctId: id, briefTitle: id },
    contactsLocationsModule: { locations: countries.map((country) => ({ country, status: "RECRUITING" })) },
  },
});
const registry = (studies: any[]) => async () => new Response(JSON.stringify({ studies }));
const assessment = (nct_id: string, fit: "likely" | "possible" | "unlikely") => ({
  nct_id, fit, reasons_for: [], reasons_against: [], to_confirm: [], plain_summary: `resumen ${nct_id}`,
});

describe("feasibility", () => {
  test("ranks home country, then region, then abroad", () => {
    expect(assessFeasibility(makeTrial("A", ["United States", "Paraguay"]), "Paraguay").proximity).toBe("same_country");
    const region = assessFeasibility(makeTrial("B", ["Spain", "Argentina"]), "Paraguay");
    expect(region.proximity).toBe("same_region");
    expect(region.closest_sites[0]!.country).toBe("Argentina");
    expect(assessFeasibility(makeTrial("C", ["Spain"]), "Paraguay").proximity).toBe("abroad");
    expect(assessFeasibility(makeTrial("D", ["Spain"]), null).proximity).toBe("abroad");
    expect(assessFeasibility(makeTrial("E", []), "Paraguay")).toMatchObject({ proximity: "abroad", site_count: 0 });
  });

  test("country names match case-insensitively", () => {
    expect(regionOf("brazil")).toBe("South America");
    expect(regionOf("Atlantis")).toBeNull();
  });
});

describe("matchPatient", () => {
  test("full pipeline: extracts, searches, assesses and ranks best fit and closest first", async () => {
    const { client, requests } = fakeClaude([
      { parsed_output: makeCase() },
      {
        parsed_output: {
          assessments: [
            assessment("NCT_US", "likely"),
            assessment("NCT_AR", "likely"),
            assessment("NCT_NO", "unlikely"),
            assessment("NCT_POSS", "possible"),
          ],
          patient_message: "hola",
          questions_for_doctor: ["¿pregunta?"],
          enrollment_checklist: ["paso"],
        },
      },
    ]);
    const result = await matchPatient("Paciente de 58 años...", {
      client,
      fetchFn: registry([
        study("NCT_NO", ["Paraguay"]),
        study("NCT_US", ["United States"]),
        study("NCT_POSS", ["Brazil"]),
        study("NCT_AR", ["Argentina"]),
      ]),
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.matches.map((m) => m.trial.nct_id)).toEqual(["NCT_AR", "NCT_US", "NCT_POSS", "NCT_NO"]);
    expect(result.patient_message).toBe("hola");
    expect(requests).toHaveLength(2);
    for (const r of requests) {
      expect(r.model).toBe(MODEL);
      expect(r.fallbacks).toBe("default");
    }
    // The assessment request carries the patient's language and every trial's criteria.
    expect(requests[1].messages[0].content).toContain("The patient's language is Spanish.");
    expect(requests[1].messages[0].content).toContain('<trial nct_id="NCT_AR">');
  });

  test("drops trials the model did not assess instead of inventing a judgement", async () => {
    const { client } = fakeClaude([
      { parsed_output: makeCase() },
      { parsed_output: { assessments: [assessment("A", "possible")], patient_message: "", questions_for_doctor: [], enrollment_checklist: [] } },
    ]);
    const result = await matchPatient("x", { client, fetchFn: registry([study("A", ["Chile"]), study("B", ["Chile"])]) });
    expect(result.status === "ok" && result.matches.map((m) => m.trial.nct_id)).toEqual(["A"]);
  });

  test("stops early when the text is not a cancer case", async () => {
    const { client, requests } = fakeClaude([{ parsed_output: makeCase({ is_cancer_case: false }) }]);
    const result = await matchPatient("I have a cold", { client, fetchFn: registry([]) });
    expect(result.status).toBe("not_a_cancer_case");
    expect(requests).toHaveLength(1);
  });

  test("reports when the registry has no recruiting trials", async () => {
    const { client } = fakeClaude([{ parsed_output: makeCase() }]);
    const result = await matchPatient("x", { client, fetchFn: registry([]) });
    expect(result.status).toBe("no_trials_found");
  });

  test("rejects empty and oversized input before calling Claude", async () => {
    const { client, requests } = fakeClaude([]);
    await expect(matchPatient("   ", { client })).rejects.toThrow(RangeError);
    await expect(matchPatient("a".repeat(MAX_INPUT_CHARS + 1), { client })).rejects.toThrow(RangeError);
    expect(requests).toHaveLength(0);
  });

  test("surfaces refusals, truncation and malformed output as ClaudeOutputError", async () => {
    for (const reply of [
      { stop_reason: "refusal", parsed_output: null, stop_details: { category: "bio" } },
      { stop_reason: "max_tokens", parsed_output: null },
      { stop_reason: "end_turn", parsed_output: null },
    ]) {
      const { client } = fakeClaude([reply]);
      await expect(matchPatient("x", { client })).rejects.toThrow(ClaudeOutputError);
    }
  });
});
