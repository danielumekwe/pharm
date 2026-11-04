// Makes pdfkit's Node.js build bundle-friendly for Cloudflare Workers.
//
// pdfkit's Node build loads its 14 standard fonts lazily with a runtime require:
//   createRequire(import.meta.url)("#standard-fonts/Helvetica")
// Bundlers cannot follow that call, so inside the Worker bundle it fails with
// `No such module "#standard-fonts/Helvetica"` and every PDF report breaks.
// This patch replaces those loaders with static imports of the same font files that pdfkit ships
// (identical data), which bundlers include. It is idempotent and refuses to guess if pdfkit changes.
//
// Runs on `postinstall` and before Worker builds.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const file = path.join(ROOT, "node_modules", "pdfkit", "js", "pdfkit.node.mjs");
const MARKER = "/* pharmacy-erp: static standard fonts */";

if (!existsSync(file)) {
  console.log("[patch-pdfkit] pdfkit not installed; nothing to do.");
  process.exit(0);
}

let source = readFileSync(file, "utf8");
if (source.includes(MARKER)) {
  console.log("[patch-pdfkit] already applied.");
  process.exit(0);
}

const loader = /require\$1\('#standard-fonts\/(\w+)'\)/g;
const fonts = [...new Set([...source.matchAll(loader)].map((match) => match[1]))];
if (fonts.length !== 14) {
  console.error(`[patch-pdfkit] expected 14 standard-font loaders, found ${fonts.length}. pdfkit changed; review this patch.`);
  process.exit(1);
}
for (const font of fonts) {
  if (!existsSync(path.join(path.dirname(file), "standard-fonts", `${font}.mjs`))) {
    console.error(`[patch-pdfkit] missing standard-fonts/${font}.mjs; review this patch.`);
    process.exit(1);
  }
}

const imports = fonts.map((font) => `import __stdFont_${font} from './standard-fonts/${font}.mjs';`).join("\n");
source = source.replace(loader, (_, font) => `__stdFont_${font}`);
source = `${MARKER}\n${imports}\n${source}`;
writeFileSync(file, source);
console.log(`[patch-pdfkit] patched ${path.relative(ROOT, file)} (${fonts.length} standard fonts now imported statically).`);
