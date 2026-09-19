import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Real temporary Git repositories; only GitHub HTTP and the expensive build are substituted.
import { createUpdater } from "../../lib/update-service.ts";
import { required } from "../bead-fixture";

type Options = Parameters<typeof createUpdater>[0];

test("updater release selection, recovery and checkout safety", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scotty-update-"));
  const remote = path.join(root, "remote");
  const clone = path.join(root, "clone");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  let latest = "v0.2.0",
    offline = false,
    status = 200;
  const http: NonNullable<Options["fetch"]> = async (input) => {
    const url = String(input);
    if (offline) throw Error("offline");
    if (status !== 200) return new Response("", { status });
    const tag = url.endsWith("/latest")
      ? latest
      : decodeURIComponent(required(url.split("/").at(-1)));
    return Response.json({ tag_name: tag, draft: false, prerelease: false });
  };
  try {
    fs.mkdirSync(remote);
    git(remote, "init", "-b", "main");
    git(remote, "config", "user.email", "test@example.invalid");
    git(remote, "config", "user.name", "Test");
    const commit = (version: string) => {
      fs.writeFileSync(
        path.join(remote, "package.json"),
        JSON.stringify({ name: "bead-me-up-scotty", version }),
      );
      git(remote, "add", ".");
      git(remote, "commit", "-m", version);
      return git(remote, "rev-parse", "HEAD");
    };
    const old = commit("0.1.0");
    git(root, "clone", remote, clone);
    git(clone, "config", "user.email", "test@example.invalid");
    git(clone, "config", "user.name", "Test");
    const release = commit("0.2.0");
    git(remote, "tag", "-a", "v0.2.0", "-m", "release");
    const newest = commit("0.3.0");
    git(remote, "tag", "v0.3.0");
    const run: NonNullable<Options["run"]> = async (cmd, args, opts) => {
      if (cmd === "git") return { stdout: git(opts.cwd, ...args), stderr: "" };
      fs.appendFileSync(path.join(root, "builds"), cmd + " " + args.join(" ") + "\n");
      return { stdout: "ok", stderr: "" };
    };
    const options: Options = {
      cwd: clone,
      version: "0.1.0",
      repository: "brendan-appstart/bead-me-up-scotty",
      remote,
      fetch: http,
      run,
    };
    const updater = createUpdater(options);
    const s = await updater.check();
    expect(s.channel).toBe("stable");
    expect(s.updateAvailable).toBe(true);
    expect(s.latestVersion).toBe("0.2.0");
    expect(required(s.target).sha).toBe(release);
    expect(required(s.target).tag).toBe("v0.2.0");
    latest = "v0.3.0"; // A later release after opening the dialog must not change the approved target.
    const result = await updater.update(required(s.target));
    expect(result.toSha).toBe(release);
    expect(git(clone, "rev-parse", "HEAD")).toBe(release);
    expect(result.toSha).not.toBe(newest);
    expect(fs.readFileSync(path.join(root, "builds"), "utf8")).toMatch(/bun run build/);
    const nogit = path.join(root, "installed");
    fs.mkdirSync(nogit);
    const installed = createUpdater({ ...options, cwd: nogit });
    const notice = await installed.check();
    expect(notice.updateAvailable).toBe(true);
    expect(notice.canUpdate).toBe(false);
    expect(notice.releaseUrl).toMatch(/releases\/tag\/v0.3.0$/);
    await expect(installed.update(required(s.target))).rejects.toThrow(/checkout/i);
    expect(
      (await createUpdater({ ...options, cwd: nogit, version: "0.3.0" }).check()).updateAvailable,
    ).toBe(false);
    expect(
      (await createUpdater({ ...options, cwd: nogit, version: "0.4.0" }).check()).updateAvailable,
      "never suggest a downgrade",
    ).toBe(false);
    expect(
      (await createUpdater({ ...options, cwd: nogit, version: "0.3.0-beta.1" }).check())
        .updateAvailable,
    ).toBe(true);
    status = 404;
    expect((await createUpdater({ ...options, cwd: nogit }).check()).updateAvailable).toBe(false);
    status = 429;
    expect((await createUpdater({ ...options, cwd: nogit }).check()).error).toMatch(/429/);
    status = 200;
    offline = true;
    expect((await createUpdater({ ...options, cwd: nogit }).check()).error).toMatch(/offline/);
    offline = false;
    fs.writeFileSync(path.join(clone, "local.txt"), "keep me");
    await expect(updater.update({ channel: "stable", tag: "v0.3.0", sha: newest })).rejects.toThrow(
      /uncommitted/i,
    );
    expect(fs.readFileSync(path.join(clone, "local.txt"), "utf8")).toBe("keep me");
    fs.unlinkSync(path.join(clone, "local.txt"));
    git(clone, "switch", "-c", "feature");
    await expect(updater.update({ channel: "stable", tag: "v0.3.0", sha: newest })).rejects.toThrow(
      /branch/i,
    );
    git(clone, "switch", "main");
    await expect(updater.update({ channel: "stable", tag: "v0.3.0", sha: old })).rejects.toThrow(
      /changed|match/i,
    );
    await expect(
      updater.update({ channel: "stable", tag: "--upload-pack=evil", sha: newest }),
    ).rejects.toThrow(/invalid/i);
    const dev = await updater.check("development");
    expect(required(dev.target).sha).toBe(newest);
    expect(dev.updateAvailable).toBe(true);
    await updater.update(required(dev.target));
    expect(git(clone, "rev-parse", "HEAD")).toBe(newest);
    // Locally diverged work must not be overwritten by an exact release update.
    git(clone, "reset", "--hard", release);
    fs.writeFileSync(path.join(clone, "custom"), "local");
    git(clone, "add", ".");
    git(clone, "commit", "-m", "local");
    const localHead = git(clone, "rev-parse", "HEAD");
    await expect(updater.update({ channel: "stable", tag: "v0.3.0", sha: newest })).rejects.toThrow(
      /diverg|fast.forward/i,
    );
    expect(git(clone, "rev-parse", "HEAD")).toBe(localHead);

    // A failed development build remains discoverable after the source advanced.
    git(clone, "reset", "--hard", release);
    const failing = createUpdater({
      ...options,
      buildSha: release,
      run: async (cmd, args, opts) => {
        if (cmd === "bun") throw Error("build unavailable");
        return run(cmd, args, opts);
      },
    });
    const failureTarget = required((await failing.check("development")).target);
    await expect(failing.update(failureTarget)).rejects.toThrow(/failed/);
    expect(git(clone, "rev-parse", "HEAD")).toBe(newest);
    expect(
      (await createUpdater({ ...options, buildSha: release }).check("development")).updateAvailable,
      "a failed build must remain retryable after reload",
    ).toBe(true);
    git(clone, "reset", "--hard", release);
    const supervised = createUpdater({ ...options, supervised: true });
    await supervised.update({ channel: "stable", tag: "v0.3.0", sha: newest });
    await expect(
      supervised.update({ channel: "stable", tag: "v0.3.0", sha: newest }),
      "the restart delay must not permit a second update",
    ).rejects.toThrow(/already running/);

    git(clone, "checkout", "--detach", release);
    await createUpdater(options).update({ channel: "stable", tag: "v0.3.0", sha: newest });
    expect(git(clone, "rev-parse", "HEAD"), "detached release installs can advance safely").toBe(
      newest,
    );
    expect(git(clone, "branch", "--show-current")).toBe("");
    const badRelease = createUpdater({
      ...options,
      cwd: nogit,
      fetch: async () =>
        Response.json({ tag_name: "v0.4.0-beta.1", draft: false, prerelease: true }),
    });
    expect((await badRelease.check()).updateAvailable).toBe(false);
    expect((await badRelease.check()).error).toMatch(/Invalid/);
    git(remote, "tag", "v0.4.0", newest);
    await expect(
      createUpdater(options).update({ channel: "stable", tag: "v0.4.0", sha: newest }),
    ).rejects.toThrow(/version do not match/);
    console.log(
      "PASS: stable notices, installed copies, semver, no-release/offline/rate-limit, exact tag update, development channel, dirty/branch/divergence/target guards",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
