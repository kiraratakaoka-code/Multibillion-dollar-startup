/**
 * Builds web/trials.json: every recruiting cancer TREATMENT trial on ClinicalTrials.gov
 * with at least one site in Latin America. The published web page can't call
 * ClinicalTrials.gov itself, so it reads this snapshot instead.
 *
 *   bun run scripts/build-snapshot.ts
 */
import { REGIONS } from "../src/feasibility";
import { normalizeStudy } from "../src/trials";

const LATAM = [...REGIONS["South America"]!, ...REGIONS["Central America & Caribbean"]!];
const FIELDS =
  "NCTId,BriefTitle,Phase,Condition,InterventionName,BriefSummary,EligibilityModule,LocationFacility,LocationCity,LocationCountry,LocationStatus,CentralContact";

const params = new URLSearchParams({
  "query.cond": "cancer",
  "query.locn": LATAM.join(" OR "),
  "filter.overallStatus": "RECRUITING",
  "filter.advanced": "AREA[StudyType]INTERVENTIONAL AND AREA[DesignPrimaryPurpose]TREATMENT",
  fields: FIELDS,
  pageSize: "200",
});

const latam = new Set(LATAM.map((c) => c.toLowerCase()));
const trials = [];
let token: string | undefined;
do {
  if (token) params.set("pageToken", token);
  const res = await fetch(`https://clinicaltrials.gov/api/v2/studies?${params}`);
  if (!res.ok) throw new Error(`ClinicalTrials.gov returned ${res.status}`);
  const body: any = await res.json();
  for (const raw of body.studies ?? []) {
    const t = normalizeStudy(raw);
    // The location search also matches closed sites; keep trials still recruiting in the region.
    if (!t.sites.some((s) => s.country && latam.has(s.country.toLowerCase()))) continue;
    trials.push({
      id: t.nct_id,
      title: t.title,
      phases: t.phases,
      conditions: t.conditions,
      interventions: t.interventions,
      summary: t.summary,
      eligibility: t.eligibility_criteria,
      min_age: t.min_age,
      max_age: t.max_age,
      sex: t.sex,
      sites: t.sites.map((s) => [s.facility, s.city, s.country]),
      contact: t.contact,
    });
  }
  token = body.nextPageToken;
} while (token);

const out = { generated_at: new Date().toISOString().slice(0, 10), source: "ClinicalTrials.gov", count: trials.length, trials };
// Some registry records carry broken characters (U+FFFD); drop them rather than publish garbage.
const json = JSON.stringify(out).replaceAll("�", "");
await Bun.write(new URL("../web/trials.json", import.meta.url), json);
console.log(`Wrote ${trials.length} trials to web/trials.json`);
