/**
 * Builds the standalone website into docs/ for GitHub Pages (or any static host):
 *   docs/index.html    the Eligo app (web/trial-matcher.html in a full HTML document)
 *   docs/trials.json   the ClinicalTrials.gov snapshot
 *   docs/standalone.js the browser bundle: Anthropic SDK + local storage (web/standalone.ts)
 *   Eligo.html         all of the above in one file: download it and open it in a browser
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
const bundle = await out.outputs[0]!.text();
await Bun.write(new URL("docs/standalone.js", root), bundle);

// Eligo.html: one self-contained file (app + trial snapshot + SDK) you can download and double-click.
// Only "</script" can close an inline <script> early; escape exactly that, leaving the rest of the code untouched.
const inline = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1");
const trialsJson = (await Bun.file(new URL("web/trials.json", root)).text()).replaceAll("<", "\\u003c");
// A function replacement, so "$&", "$'" and similar inside the code are inserted literally.
const single = html.replace(
  "<body>\n",
  () => `<body>\n<script>window.ELIGO_TRIALS = ${trialsJson};</script>\n<script>${inline(bundle)}</script>\n`,
);
await Bun.write(new URL("Eligo.html", root), single);
console.log("Built docs/index.html, docs/trials.json, docs/standalone.js and Eligo.html");
