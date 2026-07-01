import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { preview } from "vite";

const server = await preview({
  preview: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true
  },
  logLevel: "warn"
});

const playwrightCli = resolve("node_modules/@playwright/test/cli.js");
const child = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
  stdio: "inherit"
});

const exitCode = await new Promise((resolveExit) => {
  child.once("exit", (code) => resolveExit(code ?? 1));
  child.once("error", () => resolveExit(1));
});

await server.close();
process.exit(exitCode);
