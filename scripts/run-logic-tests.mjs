import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { build } from "esbuild";

await mkdir(".test-build", { recursive: true });

await build({
  entryPoints: [
    "tests/calculations.test.ts",
    "tests/entitlements.test.ts"
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: ".test-build",
  outExtension: { ".js": ".mjs" },
  logLevel: "silent"
});

const testProcess = spawn(process.execPath, [
  "--test",
  ".test-build/calculations.test.mjs",
  ".test-build/entitlements.test.mjs"
], {
  stdio: "inherit"
});

testProcess.on("exit", (code) => {
  process.exit(code ?? 1);
});
