#!/usr/bin/env bun
/**
 * Supervised production server (bead bgb). Runs `next start` and relaunches it
 * when the app requests a self-update restart (child exits with code 75). This is
 * what makes the one-click "Update now" button able to bring the server back on
 * the new build. Sets BMUS_SUPERVISED=1 so the app knows auto-restart is possible.
 *
 *   bun run build && bun run serve
 *
 * Zero deps — Bun’s Node-compatible standard library.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const RESTART_CODE = 75;
const require = createRequire(import.meta.url);

function nextBin() {
  // Resolve the next CLI from the local install. Under non-standard layouts
  // Resolve only installed dependencies; never download a CLI during startup.
  try {
    const pkg = require.resolve("next/package.json");
    return path.join(path.dirname(pkg), "dist", "bin", "next");
  } catch {
    throw new Error("Next.js is not installed. Run bun install --frozen-lockfile first.");
  }
}

const port = process.env.PORT || "3000";
const host = process.env.HOST || "localhost";
// Test hook: override the spawned command with a JSON array (BMUS_SERVE_CMD).
const override = process.env.BMUS_SERVE_CMD ? JSON.parse(process.env.BMUS_SERVE_CMD) : null;

let child = null;
let stopping = false;

function start() {
  const bin = nextBin();
  const cmd = override ? override[0] : process.execPath;
  const args = override ? override.slice(1) : [bin, "start", "-p", port, "-H", host];
  child = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, BMUS_SUPERVISED: "1", PORT: port, HOST: host },
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    if (code === RESTART_CODE) {
      console.log("\n[serve] self-update requested — relaunching the server…\n");
      start();
    } else {
      process.exit(signal ? 128 : (code ?? 0));
    }
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopping = true;
    if (!child) process.exit(0);
    // Wait for the child to actually exit before we do, so it isn't orphaned
    // holding the port (which would make the next `bun run serve` hit EADDRINUSE).
    // Force-exit if it doesn't shut down promptly.
    child.once("exit", () => process.exit(0));
    // Kill the owned child, not just this supervisor: exiting first leaves an
    // orphan holding the port and stalls systemd restarts.
    const t = setTimeout(() => child?.kill("SIGKILL"), 5000);
    if (typeof t.unref === "function") t.unref();
    child.kill(sig);
  });
}

start();
