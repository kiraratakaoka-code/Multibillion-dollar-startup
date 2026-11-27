import { z } from "zod";

/** A patient's case, extracted from free text in any language. */
export const PatientCaseSchema = z.object({
  is_cancer_case: z
    .boolean()
    .describe("False if the text does not describe a cancer patient."),
  patient_language: z
    .string()
    .describe("Language the summary is written in, in English (e.g. 'Spanish')."),
  cancer_type: z.string().describe("Primary cancer, in English (e.g. 'non-small cell lung cancer')."),
  histology: z.string().nullable(),
  stage: z.string().nullable(),
  metastatic: z.boolean().nullable(),
  biomarkers: z.array(z.string()).describe("e.g. 'EGFR exon 19 deletion', 'HER2 positive', 'PD-L1 60%'."),
  prior_treatments: z.array(z.string()),
  age: z.number().nullable(),
  sex: z.enum(["female", "male", "unknown"]),
  performance_status: z.string().nullable().describe("ECOG or Karnofsky if stated."),
  country: z.string().nullable().describe("Country where the patient lives, in English."),
  city: z.string().nullable(),
  comorbidities: z.array(z.string()),
  search_condition: z
    .string()
    .describe("Short English condition term for a trial registry search, e.g. 'non-small cell lung cancer'."),
  search_keywords: z
    .array(z.string())
    .describe("Up to 4 short English registry keywords, mainly targetable biomarkers, e.g. 'EGFR'."),
  summary_en: z.string().describe("Two-sentence clinical summary in English."),
  missing_info: z
    .array(z.string())
    .describe("Facts trials usually require that the text does not state, e.g. 'ECOG status'."),
});
export type PatientCase = z.infer<typeof PatientCaseSchema>;

/** Claude's judgement of one trial for this patient, plus a plain-language explanation. */
export const TrialAssessmentSchema = z.object({
  nct_id: z.string(),
  fit: z.enum(["likely", "possible", "unlikely"]),
  reasons_for: z.array(z.string()).describe("In English, citing the eligibility criteria."),
  reasons_against: z.array(z.string()).describe("In English, citing the eligibility criteria."),
  to_confirm: z.array(z.string()).describe("Facts a doctor must confirm before referral, in English."),
  plain_summary: z
    .string()
    .describe("What this trial tests and why it might help, in the patient's language, at a 12-year-old reading level."),
});

export const AssessmentResultSchema = z.object({
  assessments: z.array(TrialAssessmentSchema),
  patient_message: z
    .string()
    .describe("A short, warm, honest overview for the patient and family, in the patient's language."),
  questions_for_doctor: z
    .array(z.string())
    .describe("Questions to bring to the oncologist, in the patient's language."),
  enrollment_checklist: z
    .array(z.string())
    .describe(
      "Practical steps before enrolling (records to gather, costs, insurance, travel support, visas, follow-up at home), in the patient's language.",
    ),
});
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;
export type TrialAssessment = z.infer<typeof TrialAssessmentSchema>;

/** A recruiting trial, normalized from the ClinicalTrials.gov v2 API. */
export interface TrialSite {
  facility: string | null;
  city: string | null;
  country: string | null;
}

export interface Trial {
  nct_id: string;
  title: string;
  url: string;
  phases: string[];
  conditions: string[];
  interventions: string[];
  summary: string;
  eligibility_criteria: string;
  min_age: string | null;
  max_age: string | null;
  sex: string | null;
  sites: TrialSite[];
  contact: { name: string | null; phone: string | null; email: string | null } | null;
}
