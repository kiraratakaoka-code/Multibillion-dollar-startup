import type { ClaudeClient } from "../src/claude";
import type { PatientCase, Trial } from "../src/schemas";

export function makeCase(overrides: Partial<PatientCase> = {}): PatientCase {
  return {
    is_cancer_case: true,
    patient_language: "Spanish",
    cancer_type: "non-small cell lung cancer",
    histology: "adenocarcinoma",
    stage: "IV",
    metastatic: true,
    biomarkers: ["EGFR exon 19 deletion"],
    prior_treatments: ["osimertinib"],
    age: 58,
    sex: "female",
    performance_status: "ECOG 1",
    country: "Paraguay",
    city: "Asunción",
    comorbidities: [],
    search_condition: "non-small cell lung cancer",
    search_keywords: ["EGFR"],
    summary_en: "58-year-old woman with stage IV EGFR-mutant NSCLC progressing on osimertinib.",
    missing_info: [],
    ...overrides,
  };
}

export function makeTrial(id: string, countries: string[] = ["United States"]): Trial {
  return {
    nct_id: id,
    title: `Trial ${id}`,
    url: `https://clinicaltrials.gov/study/${id}`,
    phases: ["PHASE2"],
    conditions: [],
    interventions: [],
    summary: "",
    eligibility_criteria: "Inclusion Criteria: adults",
    min_age: "18 Years",
    max_age: null,
    sex: "ALL",
    sites: countries.map((country) => ({ facility: `Hospital ${country}`, city: null, country })),
    contact: null,
  };
}

/** A stand-in for the Anthropic client that returns queued replies and records requests. */
export function fakeClaude(replies: Array<{ stop_reason?: string; parsed_output: unknown; stop_details?: unknown }>) {
  const requests: any[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: any) => {
          requests.push(params);
          const next = replies.shift();
          if (!next) throw new Error("fakeClaude: no reply queued");
          return { stop_reason: "end_turn", stop_details: null, ...next };
        },
      },
    },
  } as unknown as ClaudeClient;
  return { client, requests };
}
