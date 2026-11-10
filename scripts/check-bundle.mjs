// Fails if dist/ imports a bare package the runtime image does not ship.
// The image only contains @duckdb/node-api (see Dockerfile "deps" stage).
import { builtinModules } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = [/^@duckdb\//]; // vite stays external too, but only as a dev-only dynamic import()
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
// esbuild emits every external as a top-level static import at the start of a line.
const re = /^import\s(?:[^"'\n]*?\sfrom\s)?["']([^./"'][^"']*)["']/gm;

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".js") ? [join(d, e.name)] : [],
  );

const bad = new Map();
for (const f of walk(process.argv[2] ?? "dist")) {
  for (const [, spec] of readFileSync(f, "utf8").matchAll(re)) {
    if (builtins.has(spec) || spec.startsWith("node:") || ALLOWED.some((a) => a.test(spec))) continue;
    bad.set(spec, f);
  }
}
if (bad.size) {
  console.error("dist imports packages missing from the runtime image:");
  for (const [s, f] of bad) console.error(`  ${s}  (${f})`);
  process.exit(1);
}
console.log("bundle check ok");
