// Bundles web/app.js (and the engine it imports) into one self-contained HTML file: dist/tagfix.html
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const res = await build({
  entryPoints: ["web/app.js"], bundle: true, format: "iife", minify: true, write: false, target: "es2020",
});
const js = res.outputFiles[0].text.replaceAll("</script", "<\\/script");
const html = readFileSync("web/template.html", "utf8").replace("<script>/*APP*/</script>", () => `<script>${js}</script>`);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/tagfix.html", html);
console.log(`dist/tagfix.html ${(html.length / 1024).toFixed(1)} KB`);
