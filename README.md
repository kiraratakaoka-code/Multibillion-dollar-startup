# Trial Matcher (MVP)

The first piece of the global cancer trial access company described in
[`docs/designs/global-trial-access.md`](docs/designs/global-trial-access.md): the shared **matching engine**.

Paste a cancer patient's summary in **any language** and get:

1. **The case**: Claude extracts cancer type, stage, biomarkers, prior treatments, location, and what's missing.
2. **Recruiting treatment trials** from [ClinicalTrials.gov](https://clinicaltrials.gov), searched in three passes:
   trials near the patient (their country and travel region) first, then the best biomarker-matched trials worldwide,
   then the cancer type alone. Closed sites are dropped.
3. **A fit judgement for each trial** (likely, possible or unlikely) against its eligibility criteria, with reasons and what a doctor must confirm.
4. **A plain-language explanation in the patient's language**, questions for their oncologist, and an enrollment checklist covering costs, travel, visas and follow-up at home.

> Prototype only. Use fictional or de-identified cases, never real names or ID numbers.
> Not medical advice: a treating oncologist must confirm every match.

## Run it

Needs [Bun](https://bun.sh) and an Anthropic API key.

```bash
bun install
```

```bash
export ANTHROPIC_API_KEY=your-key
```

```bash
bun run start
```

Then open http://localhost:3000 and click a sample case. Or from the terminal:

```bash
bun run match samples/es-lung.txt
```

## Test

```bash
bun test
```

```bash
bun run typecheck
```

The tests use a recorded ClinicalTrials.gov response (`test/fixtures/`) and a fake Claude client, so they need no key or network.

## How it works

| File | What it does |
|---|---|
| `src/claude.ts` | The two Claude calls: case extraction and trial assessment, with structured outputs and refusal fallback |
| `src/trials.ts` | ClinicalTrials.gov v2 search and normalization |
| `src/feasibility.ts` | Where the patient could go: same country, same region, or abroad |
| `src/engine.ts` | The pipeline and ranking (best fit first, then closest) |
| `src/server.ts` / `public/index.html` | The web page and its API |
| `src/cli.ts` | Command-line version |

## Next

- Run the 5 hand-run tumor board cases (the design doc's assignment) through it and note what was wrong or missing.
- Contact details and sponsor travel-support info per site.
- Uploading PDFs and photos of medical records.

## Eligo web app

One app (`web/trial-matcher.html`) with a home page, the trial matcher, patient profiles and remote tumor boards.
It runs two ways:

| | Inside Claude | Standalone website (GitHub Pages) |
|---|---|---|
| Link | https://claude.ai/artifact/Ee8uiZCgqSRLCs2ga4Xgxa (private until shared) | `https://kiraratakaoka-code.github.io/Multibillion-dollar-startup/` once Pages is on |
| Claude | The viewer's own Claude account | Your Anthropic API key, pasted in the app's Settings (saved only in that browser) |
| Data | Shared workspace: doctors you share it with see the same patients and boards | Saved in that browser only |

Published pages can't call ClinicalTrials.gov, so the app reads `web/trials.json`: every recruiting cancer
treatment trial with a site in Latin America.

### Open it as a single file

`Eligo.html` (in the repo's top folder) is the whole app in one file: the app, the trial snapshot and the Anthropic SDK.
On GitHub, open `Eligo.html`, click the download button (**Download raw file**), then double-click the downloaded file.
It opens in your browser; add your API key in **Settings** the first time. Data stays in that browser.

### Turn on the website (once)

1. On GitHub: **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Pick the branch (`main` once this is merged) and the **/docs** folder, then **Save**.
4. After a minute, open `https://kiraratakaoka-code.github.io/Multibillion-dollar-startup/`, go to **Settings** in the app and paste your Anthropic API key.

### Rebuild after changes

```bash
bun run snapshot
```

```bash
bun run build:site
```

`build:site` writes `docs/index.html`, `docs/trials.json`, `docs/standalone.js` (the Anthropic SDK bundled for the browser) and the single-file `Eligo.html`.
