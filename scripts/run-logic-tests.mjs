import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { build } from "esbuild";

await mkdir(".test-build", { recursive: true });

await build({
  entryPoints: ["tests/calculations.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".test-build/calculations.test.mjs",
  logLevel: "silent"
});

const testProcess = spawn(process.execPath, ["--test", ".test-build/calculations.test.mjs"], {
  stdio: "inherit"
});

testProcess.on("exit", (code) => {
  process.exit(code ?? 1);
});
