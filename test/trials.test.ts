import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/ctgov-nsclc-egfr.json";
import { buildSearchUrls, normalizeStudy, searchTrials } from "../src/trials";
import { makeCase } from "./helpers";

describe("normalizeStudy (real ClinicalTrials.gov data)", () => {
  const [multi, single] = fixture.studies.map(normalizeStudy);

  test("keeps only sites that are still recruiting", () => {
    // 94 sites listed: 3 RECRUITING, the rest completed, withdrawn, terminated or not recruiting.
    expect(multi!.sites).toHaveLength(3);
    expect(new Set(multi!.sites.map((s) => s.country))).toEqual(new Set(["Hong Kong", "Portugal", "United States"]));
  });

  test("maps identifiers, eligibility and contact", () => {
    expect(multi!.nct_id).toBe("NCT05099172");
    expect(multi!.url).toBe("https://clinicaltrials.gov/study/NCT05099172");
    expect(multi!.phases).toEqual(["PHASE1", "PHASE2"]);
    expect(multi!.eligibility_criteria).toContain("Inclusion Criteria");
    expect(multi!.min_age).toBe("18 Years");
    expect(multi!.contact?.email).toBe("clinical-trials-contact@bayer.com");
  });

  test("tolerates missing modules", () => {
    expect(single!.phases).toEqual([]);
    expect(single!.sites).toEqual([{ facility: "National Taiwan University", city: "Taipei", country: "Taiwan" }]);
    const empty = normalizeStudy({ protocolSection: { identificationModule: { nctId: "NCT0" } } });
    expect(empty).toMatchObject({ nct_id: "NCT0", sites: [], contact: null, eligibility_criteria: "" });
  });
});

describe("buildSearchUrls", () => {
  test("nearby biomarker search, then global biomarker, then condition only", () => {
    const urls = buildSearchUrls(makeCase({ search_keywords: ["EGFR", " ", "HER2"] }), 10).map((u) => new URL(u));
    expect(urls).toHaveLength(3);
    const locn = urls[0]!.searchParams.get("query.locn")!;
    expect(locn).toContain("Paraguay");
    expect(locn).toContain("Argentina OR");
    expect(urls[0]!.searchParams.get("query.term")).toBe("EGFR OR HER2");
    expect(urls[1]!.searchParams.get("query.term")).toBe("EGFR OR HER2");
    expect(urls[1]!.searchParams.has("query.locn")).toBe(false);
    expect(urls[2]!.searchParams.has("query.term")).toBe(false);
    for (const u of urls) {
      expect(u.searchParams.get("query.cond")).toBe("non-small cell lung cancer");
      expect(u.searchParams.get("filter.overallStatus")).toBe("RECRUITING");
      expect(u.searchParams.get("filter.advanced")).toBe("AREA[StudyType]INTERVENTIONAL AND AREA[DesignPrimaryPurpose]TREATMENT");
      expect(u.searchParams.get("pageSize")).toBe("10");
    }
  });

  test("a country outside the known regions searches that country only", () => {
    const first = new URL(buildSearchUrls(makeCase({ country: "Kenya" }), 5)[0]!);
    expect(first.searchParams.get("query.locn")).toBe("Kenya");
  });

  test("no location and no keywords means a single condition search", () => {
    expect(buildSearchUrls(makeCase({ search_keywords: [], country: null }), 5)).toHaveLength(1);
  });
});

describe("searchTrials", () => {
  const study = (id: string) => ({ protocolSection: { identificationModule: { nctId: id, briefTitle: id } } });
  const reply = (ids: string[]) => new Response(JSON.stringify({ studies: ids.map(study) }));

  test("merges searches in order without duplicates and stops at the limit", async () => {
    const calls: string[] = [];
    const pages = [["A"], ["A", "B"], ["B", "C", "D"]];
    const { trials, queries } = await searchTrials(makeCase(), {
      limit: 3,
      fetchFn: async (url) => (calls.push(url), reply(pages[calls.length - 1]!)),
    });
    expect(trials.map((t) => t.nct_id)).toEqual(["A", "B", "C"]);
    expect(calls).toHaveLength(3);
    expect(queries).toEqual(calls);
  });

  test("nearby results take at most half the slots", async () => {
    const pages = [["N1", "N2", "N3", "N4"], ["G1", "G2", "G3"], ["X"]];
    let n = 0;
    const { trials } = await searchTrials(makeCase(), { limit: 4, fetchFn: async () => reply(pages[n++]!) });
    expect(trials.map((t) => t.nct_id)).toEqual(["N1", "N2", "G1", "G2"]);
    expect(n).toBe(2);
  });

  test("skips later searches once the limit is reached", async () => {
    let n = 0;
    const { trials } = await searchTrials(makeCase({ country: null }), {
      limit: 2,
      fetchFn: async () => (n++, reply(["A", "B", "C"])),
    });
    expect(trials).toHaveLength(2);
    expect(n).toBe(1);
  });

  test("reports registry errors", async () => {
    const fetchFn = async () => new Response("down", { status: 503 });
    await expect(searchTrials(makeCase(), { fetchFn })).rejects.toThrow(/ClinicalTrials.gov returned 503/);
  });
});
