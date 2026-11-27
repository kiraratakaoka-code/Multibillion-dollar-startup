import Anthropic from "@anthropic-ai/sdk";
import { matchPatient } from "./engine";

const file = process.argv[2];
if (!file) {
  console.error("Usage: bun run match <patient-summary.txt>");
  process.exit(1);
}

const result = await matchPatient(await Bun.file(file).text(), { client: new Anthropic() });

if (result.status !== "ok") {
  console.log(`Result: ${result.status}`);
  console.log(JSON.stringify(result.patient, null, 2));
  process.exit(0);
}

const p = result.patient;
console.log(`Patient: ${p.summary_en}`);
console.log(`Language: ${p.patient_language} | Country: ${p.country ?? "unknown"}`);
if (p.missing_info.length) console.log(`Missing: ${p.missing_info.join("; ")}`);
console.log(`\n${result.patient_message}\n`);
for (const m of result.matches) {
  console.log(`[${m.assessment.fit.toUpperCase()}] ${m.trial.nct_id} ${m.trial.title}`);
  console.log(`  ${m.feasibility.proximity.replace("_", " ")}; ${m.feasibility.site_count} sites in ${m.feasibility.countries.slice(0, 5).join(", ")}`);
  console.log(`  ${m.assessment.plain_summary}`);
  console.log(`  ${m.trial.url}\n`);
}
