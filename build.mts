import { build } from "esbuild"

await build({
  entryPoints: ["src/runner.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  outfile: "dist/runner.js",
  tsconfig: "tsconfig.json",
})
