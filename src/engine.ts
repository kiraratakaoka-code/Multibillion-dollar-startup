import { assessTrials, extractCase, type ClaudeClient } from "./claude";
import { assessFeasibility, type Feasibility } from "./feasibility";
import type { PatientCase, Trial, TrialAssessment } from "./schemas";
import { searchTrials, type FetchFn } from "./trials";

export interface MatchedTrial {
  trial: Trial;
  feasibility: Feasibility;
  assessment: TrialAssessment;
}

export type MatchResult =
  | { status: "not_a_cancer_case"; patient: PatientCase }
  | { status: "no_trials_found"; patient: PatientCase; queries: string[] }
  | {
      status: "ok";
      patient: PatientCase;
      queries: string[];
      matches: MatchedTrial[];
      patient_message: string;
      questions_for_doctor: string[];
      enrollment_checklist: string[];
    };

const FIT_ORDER = { likely: 0, possible: 1, unlikely: 2 } as const;
const PROXIMITY_ORDER = { same_country: 0, same_region: 1, abroad: 2 } as const;

/** Best fit first; among equal fits, the closest sites first. */
export function rankMatches(matches: MatchedTrial[]): MatchedTrial[] {
  return [...matches].sort(
    (a, b) =>
      FIT_ORDER[a.assessment.fit] - FIT_ORDER[b.assessment.fit] ||
      PROXIMITY_ORDER[a.feasibility.proximity] - PROXIMITY_ORDER[b.feasibility.proximity],
  );
}

export const MAX_INPUT_CHARS = 20000;

/**
 * Patient summary (any language) -> structured case -> recruiting trials ->
 * per-trial fit and a plain-language explanation in the patient's language.
 */
export async function matchPatient(
  text: string,
  deps: { client: ClaudeClient; fetchFn?: FetchFn; limit?: number },
): Promise<MatchResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new RangeError("The patient summary is empty.");
  if (trimmed.length > MAX_INPUT_CHARS) {
    throw new RangeError(`The patient summary is longer than ${MAX_INPUT_CHARS} characters. Shorten it to the key facts.`);
  }

  const patient = await extractCase(deps.client, trimmed);
  if (!patient.is_cancer_case) return { status: "not_a_cancer_case", patient };

  const { trials, queries } = await searchTrials(patient, { fetchFn: deps.fetchFn, limit: deps.limit });
  if (trials.length === 0) return { status: "no_trials_found", patient, queries };

  const withFeasibility = trials.map((trial) => ({ trial, feasibility: assessFeasibility(trial, patient.country) }));
  const result = await assessTrials(deps.client, patient, withFeasibility);

  const byId = new Map(result.assessments.map((a) => [a.nct_id, a]));
  const matches: MatchedTrial[] = [];
  for (const { trial, feasibility } of withFeasibility) {
    const assessment = byId.get(trial.nct_id);
    // A trial the model skipped is dropped rather than shown with an invented judgement.
    if (assessment) matches.push({ trial, feasibility, assessment });
  }

  return {
    status: "ok",
    patient,
    queries,
    matches: rankMatches(matches),
    patient_message: result.patient_message,
    questions_for_doctor: result.questions_for_doctor,
    enrollment_checklist: result.enrollment_checklist,
  };
}
