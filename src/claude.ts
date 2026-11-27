import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import {
  AssessmentResultSchema,
  PatientCaseSchema,
  type AssessmentResult,
  type PatientCase,
  type Trial,
} from "./schemas";
import type { Feasibility } from "./feasibility";

export const MODEL = "claude-opus-5-5";

/** The slice of the SDK client the engine uses, so tests can pass a fake. */
export type ClaudeClient = Pick<Anthropic, "beta">;

const EXTRACT_SYSTEM = `You read cancer patient summaries written by patients, families or doctors, in any language, and extract the facts a clinical trial coordinator needs.
Rules:
- Extract only what the text states. Never guess a biomarker, stage or age. Use null or an empty list when it is not stated, and list it in missing_info if trials usually require it.
- Write every field in English, except patient_language, which names the language of the text.
- If the text does not describe a person with cancer, set is_cancer_case to false.`;

const ASSESS_SYSTEM = `You are a careful clinical trial navigator. For one patient and a list of recruiting trials, judge each trial against its eligibility criteria and explain the options to the patient and family.
Rules:
- Judge only from the patient facts and the criteria provided. "likely": no criterion clearly excludes the patient and the key inclusion criteria are met. "possible": key facts are missing or need a doctor to confirm. "unlikely": a criterion clearly excludes the patient.
- Cite the specific criterion in reasons_for and reasons_against.
- Return one assessment for every trial, using its exact nct_id.
- Write plain_summary, patient_message, questions_for_doctor and enrollment_checklist in the patient's language, simply, for a family with no medical training.
- Be honest and never promise a place in a trial or a benefit. Say that the treating oncologist must confirm eligibility.
- In the enrollment checklist, cover what usually blocks people: records and pathology to gather, who pays for travel and routine care (ask the trial site; many sponsors reimburse travel), insurance, visas for trials abroad, and follow-up back home.`;

export class ClaudeOutputError extends Error {}

async function parseWith<T extends z.ZodType>(
  client: ClaudeClient,
  schema: T,
  params: { system: string; user: string; max_tokens: number; effort: "low" | "medium" | "high" },
): Promise<z.infer<T>> {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: params.max_tokens,
    betas: ["server-side-fallback-2026-07-01"],
    // If a safety classifier declines, the API retries on a suitable fallback model in the same call.
    fallbacks: "default",
    system: params.system,
    output_config: { effort: params.effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content: params.user }],
  });
  if (response.stop_reason === "refusal") {
    throw new ClaudeOutputError(
      `Claude declined the request (${response.stop_details?.category ?? "no category"}).`,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new ClaudeOutputError("Claude's answer was cut off (max_tokens). Try fewer trials.");
  }
  if (response.parsed_output == null) {
    throw new ClaudeOutputError("Claude's answer did not match the expected format.");
  }
  return response.parsed_output as z.infer<T>;
}

export function extractCase(client: ClaudeClient, text: string): Promise<PatientCase> {
  return parseWith(client, PatientCaseSchema, {
    system: EXTRACT_SYSTEM,
    user: `<patient_summary>\n${text}\n</patient_summary>`,
    max_tokens: 16000,
    effort: "medium",
  });
}

export function assessTrials(
  client: ClaudeClient,
  patient: PatientCase,
  trials: { trial: Trial; feasibility: Feasibility }[],
): Promise<AssessmentResult> {
  const trialBlocks = trials
    .map(
      ({ trial, feasibility }) => `<trial nct_id="${trial.nct_id}">
Title: ${trial.title}
Phase: ${trial.phases.join(", ") || "not stated"}
Interventions: ${trial.interventions.join(", ") || "not stated"}
Age: ${trial.min_age ?? "no minimum"} to ${trial.max_age ?? "no maximum"}; sex: ${trial.sex ?? "all"}
Recruiting sites: ${feasibility.site_count} in ${feasibility.countries.join(", ") || "unknown countries"}; closest to the patient: ${feasibility.proximity.replace("_", " ")}
Summary: ${trial.summary}
Eligibility criteria:
${trial.eligibility_criteria}
</trial>`,
    )
    .join("\n\n");

  return parseWith(client, AssessmentResultSchema, {
    system: ASSESS_SYSTEM,
    user: `<patient>\n${JSON.stringify(patient, null, 2)}\n</patient>\n\n<trials>\n${trialBlocks}\n</trials>\n\nThe patient's language is ${patient.patient_language}.`,
    max_tokens: 32000,
    effort: "high",
  });
}
