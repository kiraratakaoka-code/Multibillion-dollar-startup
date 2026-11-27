import type { Trial } from "./schemas";

/** Rough travel regions. Same region usually means a bus ride or a short flight, no long-haul visa trip. */
export const REGIONS: Record<string, string[]> = {
  "South America": [
    "Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador", "Guyana",
    "Paraguay", "Peru", "Suriname", "Uruguay", "Venezuela",
  ],
  "Central America & Caribbean": [
    "Mexico", "Guatemala", "Belize", "Honduras", "El Salvador", "Nicaragua", "Costa Rica",
    "Panama", "Cuba", "Dominican Republic", "Puerto Rico", "Jamaica", "Haiti",
  ],
  "North America": ["United States", "Canada"],
  Europe: [
    "Spain", "Portugal", "France", "Italy", "Germany", "United Kingdom", "Netherlands",
    "Belgium", "Switzerland", "Austria", "Poland", "Ireland", "Sweden", "Norway", "Denmark",
    "Finland", "Greece", "Czechia", "Hungary", "Romania",
  ],
};

export function regionOf(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = country.trim().toLowerCase();
  for (const [region, countries] of Object.entries(REGIONS)) {
    if (countries.some((x) => x.toLowerCase() === c)) return region;
  }
  return null;
}

export type Proximity = "same_country" | "same_region" | "abroad";

export interface Feasibility {
  proximity: Proximity;
  site_count: number;
  countries: string[];
  closest_sites: { facility: string | null; city: string | null; country: string | null }[];
}

/** Where the patient could go for this trial, closest first. Pure: no network, no model. */
export function assessFeasibility(trial: Trial, patientCountry: string | null): Feasibility {
  const home = patientCountry?.trim().toLowerCase() ?? null;
  const homeRegion = regionOf(patientCountry);
  const rank = (country: string | null) => {
    if (home && country?.toLowerCase() === home) return 0;
    if (homeRegion && regionOf(country) === homeRegion) return 1;
    return 2;
  };
  const sorted = [...trial.sites].sort((a, b) => rank(a.country) - rank(b.country));
  const best = sorted.length > 0 ? rank(sorted[0]!.country) : 2;
  const proximity: Proximity = best === 0 ? "same_country" : best === 1 ? "same_region" : "abroad";
  const countries = [...new Set(trial.sites.map((s) => s.country).filter((c): c is string => !!c))];
  return { proximity, site_count: trial.sites.length, countries, closest_sites: sorted.slice(0, 3) };
}
