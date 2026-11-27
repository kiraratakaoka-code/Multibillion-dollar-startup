import { REGIONS, regionOf } from "./feasibility";
import type { PatientCase, Trial, TrialSite } from "./schemas";

const API = "https://clinicaltrials.gov/api/v2/studies";
const FIELDS = [
  "NCTId",
  "BriefTitle",
  "Phase",
  "Condition",
  "InterventionName",
  "BriefSummary",
  "EligibilityModule",
  "LocationFacility",
  "LocationCity",
  "LocationCountry",
  "LocationStatus",
  "CentralContact",
].join(",");

/** Sites whose status says they are not taking patients. */
const CLOSED_SITE_STATUSES = new Set([
  "COMPLETED",
  "TERMINATED",
  "WITHDRAWN",
  "SUSPENDED",
  "ACTIVE_NOT_RECRUITING",
]);

export type FetchFn = (url: string) => Promise<Response>;

export interface TrialSearch {
  trials: Trial[];
  queries: string[];
}

/** Turns one raw ClinicalTrials.gov v2 study into a Trial. */
export function normalizeStudy(raw: any): Trial {
  const p = raw?.protocolSection ?? {};
  const id = p.identificationModule ?? {};
  const elig = p.eligibilityModule ?? {};
  const locs: any[] = p.contactsLocationsModule?.locations ?? [];
  const contact = p.contactsLocationsModule?.centralContacts?.[0];
  const sites: TrialSite[] = locs
    .filter((l) => !CLOSED_SITE_STATUSES.has(l?.status))
    .map((l) => ({ facility: l.facility ?? null, city: l.city ?? null, country: l.country ?? null }));

  return {
    nct_id: id.nctId,
    title: id.briefTitle ?? "",
    url: `https://clinicaltrials.gov/study/${id.nctId}`,
    phases: p.designModule?.phases ?? [],
    conditions: p.conditionsModule?.conditions ?? [],
    interventions: (p.armsInterventionsModule?.interventions ?? []).map((i: any) => i.name).filter(Boolean),
    summary: p.descriptionModule?.briefSummary ?? "",
    eligibility_criteria: elig.eligibilityCriteria ?? "",
    min_age: elig.minimumAge ?? null,
    max_age: elig.maximumAge ?? null,
    sex: elig.sex ?? null,
    sites,
    contact: contact
      ? { name: contact.name ?? null, phone: contact.phone ?? null, email: contact.email ?? null }
      : null,
  };
}

/** Countries to search first: the patient's travel region, or just their country. */
export function nearbyCountries(country: string | null): string[] {
  const region = regionOf(country);
  if (region) return REGIONS[region]!;
  return country ? [country] : [];
}

export function buildSearchUrls(c: PatientCase, pageSize: number): string[] {
  const base = (extra: Record<string, string>) => {
    const params = new URLSearchParams({
      "query.cond": c.search_condition,
      "filter.overallStatus": "RECRUITING",
      // Treatment trials only: observational, diagnostic and screening studies do not give patients a new therapy.
      "filter.advanced": "AREA[StudyType]INTERVENTIONAL AND AREA[DesignPrimaryPurpose]TREATMENT",
      fields: FIELDS,
      pageSize: String(pageSize),
      ...extra,
    });
    return `${API}?${params}`;
  };
  const keywords = c.search_keywords.map((k) => k.trim()).filter(Boolean).slice(0, 4);
  const term: Record<string, string> = keywords.length > 0 ? { "query.term": keywords.join(" OR ") } : {};
  const nearby = nearbyCountries(c.country);
  const urls: string[] = [];
  // 1. Trials the patient can reach by bus or a short flight.
  if (nearby.length > 0) urls.push(base({ ...term, "query.locn": nearby.join(" OR ") }));
  // 2. The cancer plus its targetable biomarkers, anywhere in the world.
  if (keywords.length > 0) urls.push(base(term));
  // 3. The cancer alone, to catch trials that are not biomarker-specific.
  urls.push(base({}));
  return urls;
}

/**
 * Finds recruiting trials for a case. Runs the biomarker search first and
 * fills up with condition-only results, without duplicates.
 */
export async function searchTrials(
  c: PatientCase,
  opts: { limit?: number; fetchFn?: FetchFn } = {},
): Promise<TrialSearch> {
  const limit = opts.limit ?? 12;
  const fetchFn = opts.fetchFn ?? ((url: string) => fetch(url));
  const byId = new Map<string, Trial>();
  const queries: string[] = [];

  for (const url of buildSearchUrls(c, limit)) {
    if (byId.size >= limit) break;
    // Nearby trials take at most half the slots, so the best-targeted trials worldwide still appear.
    const cap = url.includes("query.locn=") ? Math.ceil(limit / 2) : limit;
    queries.push(url);
    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`ClinicalTrials.gov returned ${res.status} for ${url}`);
    }
    const body: any = await res.json();
    for (const raw of body.studies ?? []) {
      const trial = normalizeStudy(raw);
      if (trial.nct_id && !byId.has(trial.nct_id) && byId.size < cap) byId.set(trial.nct_id, trial);
    }
  }
  return { trials: [...byId.values()], queries };
}
