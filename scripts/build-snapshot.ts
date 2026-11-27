/**
 * Builds the worldwide trial snapshot the web app reads (published pages can't call ClinicalTrials.gov):
 *
 *   docs/data/index.json   every recruiting cancer TREATMENT trial worldwide, compact: enough to search,
 *                          shortlist and count (id, title, conditions, treatments, phases, countries, site count)
 *   docs/data/t/NN.json    full details (summary, eligibility, recruiting sites, contact), in 100 files keyed
 *                          by the last two digits of the NCT number, loaded only for trials someone looks at
 *
 *   bun run snapshot
 */
import { mkdir, rm } from "node:fs/promises";
import { normalizeStudy } from "../src/trials";

const FIELDS =
  "NCTId,BriefTitle,Phase,Condition,InterventionName,BriefSummary,EligibilityModule,LocationFacility,LocationCity,LocationCountry,LocationStatus,CentralContact";
const params = new URLSearchParams({
  "query.cond": "cancer",
  "filter.overallStatus": "RECRUITING",
  "filter.advanced": "AREA[StudyType]INTERVENTIONAL AND AREA[DesignPrimaryPurpose]TREATMENT",
  fields: FIELDS,
  pageSize: "1000",
});

// Some registry records carry broken characters (U+FFFD); drop them rather than publish garbage.
const clean = (s: string) => s.replaceAll("�", "");
const index: unknown[] = [];
const buckets = new Map<string, Record<string, unknown>>();
let token: string | undefined;
let pages = 0;
do {
  if (token) params.set("pageToken", token);
  const res = await fetch(`https://clinicaltrials.gov/api/v2/studies?${params}`);
  if (!res.ok) throw new Error(`ClinicalTrials.gov returned ${res.status}`);
  const body: any = await res.json();
  for (const raw of body.studies ?? []) {
    const t = normalizeStudy(raw);
    if (!t.nct_id || !t.sites.length) continue; // only trials with at least one site still recruiting
    const countries = [...new Set(t.sites.map((s) => s.country).filter((c): c is string => !!c))];
    index.push([t.nct_id, clean(t.title), t.conditions.map(clean), t.interventions.map(clean), t.phases, countries, t.sites.length]);
    const key = t.nct_id.slice(-2);
    if (!buckets.has(key)) buckets.set(key, {});
    buckets.get(key)![t.nct_id] = {
      summary: clean(t.summary),
      eligibility: clean(t.eligibility_criteria),
      min_age: t.min_age, max_age: t.max_age, sex: t.sex,
      sites: t.sites.map((s) => [s.facility && clean(s.facility), s.city && clean(s.city), s.country]),
      contact: t.contact,
    };
  }
  token = body.nextPageToken;
  console.log(`page ${++pages}: ${index.length} trials so far`);
} while (token);

// Written straight into docs/ so GitHub Pages serves it; the Claude version publishes the same files.
const dir = new URL("../docs/data/", import.meta.url);
await rm(dir, { recursive: true, force: true });
await mkdir(new URL("t/", dir), { recursive: true });
const generated_at = new Date().toISOString().slice(0, 10);
await Bun.write(new URL("index.json", dir), JSON.stringify({
  generated_at, source: "ClinicalTrials.gov", count: index.length,
  fields: ["id", "title", "conditions", "interventions", "phases", "countries", "site_count"], trials: index,
}));
for (const [key, trials] of buckets) await Bun.write(new URL(`t/${key}.json`, dir), JSON.stringify(trials));
console.log(`Wrote ${index.length} trials: docs/data/index.json and ${buckets.size} detail files`);
