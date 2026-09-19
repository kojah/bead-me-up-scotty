import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Never point mutating E2E flows at personal settings or a real Beads database.
const configDir = mkdtempSync(join(tmpdir(), "scotty-e2e-"));
const child = spawn(process.execPath, ["scripts/serve.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    XDG_CONFIG_HOME: configDir,
    BEADS_DEMO: "1",
    BEADS_REPO: "",
    POSTHOG_KEY: "",
    SCOTTY_READ_ONLY: "1",
    HOST: "127.0.0.1",
    PORT: "43188",
  },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  rmSync(configDir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
