/**
 * Builds the standalone website into docs/ for GitHub Pages (or any static host):
 *   docs/index.html    the Eligo app (web/trial-matcher.html in a full HTML document)
 *   docs/trials.json   the ClinicalTrials.gov snapshot
 *   docs/standalone.js the browser bundle: Anthropic SDK + local storage (web/standalone.ts)
 *
 *   bun run build:site
 */
const root = new URL("../", import.meta.url);
const page = await Bun.file(new URL("web/trial-matcher.html", root)).text();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${page}
</body>
</html>
`;
await Bun.write(new URL("docs/index.html", root), html);
await Bun.write(new URL("docs/trials.json", root), Bun.file(new URL("web/trials.json", root)));
// GitHub Pages runs Jekyll by default, which would skip or rewrite files; serve them as they are.
await Bun.write(new URL("docs/.nojekyll", root), "");

const out = await Bun.build({
  entrypoints: [new URL("web/standalone.ts", root).pathname],
  target: "browser",
  minify: true,
  format: "iife",
});
if (!out.success) {
  for (const log of out.logs) console.error(log);
  process.exit(1);
}
await Bun.write(new URL("docs/standalone.js", root), out.outputs[0]!);
console.log("Built docs/index.html, docs/trials.json, docs/standalone.js");
