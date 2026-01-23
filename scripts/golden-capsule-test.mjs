import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const bundleRoot = process.env.GOLDEN_CAPSULE_BUNDLE;

if (!bundleRoot) {
  process.stderr.write("GOLDEN_CAPSULE_BUNDLE is not set.\n");
  process.exit(1);
}

const resolvedRoot = resolve(bundleRoot);

try {
  await access(resolvedRoot);
} catch (error) {
  process.stderr.write(`Golden capsule bundle not found: ${resolvedRoot}\n`);
  process.exit(1);
}

const scriptUrl = new URL("./verify-ledger-bundle.mjs", import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);

const child = spawn(process.execPath, [scriptPath, resolvedRoot], {
  stdio: "inherit",
});

child.on("close", (code) => {
  process.exit(code ?? 1);
});
