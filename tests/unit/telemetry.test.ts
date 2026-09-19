import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTelemetry } from "../../lib/telemetry.ts";

type Options = Parameters<typeof createTelemetry>[0];
type EventPayload = {
  api_key: string;
  distinct_id: string;
  uuid: string;
  event: string;
  timestamp: string;
  properties: { app_version: string; $process_person_profile: boolean; $geoip_disable: boolean };
};

test("telemetry privacy, daily claims and bounded delivery retries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scotty-telemetry-"));
  const file = join(dir, "telemetry.json");
  let now = new Date("2026-09-08T12:00:00Z");
  const sent: { url: Parameters<typeof fetch>[0]; body: EventPayload }[] = [];
  let offline = false;
  const options: Options = {
    file,
    key: "test-project-token",
    host: "https://us.i.posthog.com",
    version: "1.2.3",
    now: () => now,
    send: async (url, init) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      if (offline) throw new Error("offline");
      return new Response("1");
    },
  };
  try {
    const freshEvents: EventPayload[] = [];
    const fresh = createTelemetry({
      ...options,
      file: join(dir, "fresh.json"),
      key: undefined,
      send: async (_url, init) => {
        freshEvents.push(JSON.parse(String(init?.body)));
        return new Response("1");
      },
    });
    await fresh.capture();
    expect(
      freshEvents.length,
      "a fresh installation must report without a local environment token",
    ).toBe(1);
    expect(freshEvents[0].api_key, "only a public capture token may ship").toMatch(
      /^phc_[A-Za-z0-9]+$/,
    );
    expect(fresh.settings()).toStrictEqual({ enabled: true, configured: true });
    const t = createTelemetry(options);
    expect(t.settings().enabled).toBe(true);
    await Promise.all([t.capture(), t.capture(), t.capture()]);
    expect(sent.length, "concurrent tabs must not duplicate daily activity").toBe(1);
    const id = sent[0].body.distinct_id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0].body.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0]).toStrictEqual({
      url: "https://us.i.posthog.com/i/v0/e/",
      body: {
        api_key: "test-project-token",
        event: "app_active",
        distinct_id: id,
        uuid: sent[0].body.uuid,
        timestamp: "2026-09-08T12:00:00.000Z",
        properties: { app_version: "1.2.3", $process_person_profile: false, $geoip_disable: true },
      },
    });
    await createTelemetry(options).capture();
    expect(sent.length, "restart must preserve daily limit").toBe(1);
    t.setEnabled(false);
    now = new Date("2026-09-09T12:00:00Z");
    await createTelemetry(options).capture();
    expect(sent.length, "opt-out must survive restart").toBe(1);
    t.setEnabled(true);
    await t.capture();
    expect(sent.length).toBe(2);
    expect(sent[1].body.distinct_id).toBe(id);
    now = new Date("2026-09-10T12:00:00Z");
    offline = true;
    await t.capture();
    await t.capture();
    expect(sent.length, "offline failures must not retry repeatedly").toBe(3);
    const noKey = createTelemetry({ ...options, file: join(dir, "no-key.json"), key: "" });
    await noKey.capture();
    expect(sent.length).toBe(3);
    const invalidHost = createTelemetry({
      ...options,
      file: join(dir, "invalid-host.json"),
      host: "http://us.i.posthog.com",
    });
    await invalidHost.capture();
    expect(sent.length, "never send a token over plain HTTP").toBe(3);
    const blockedFile = join(dir, "not-a-directory");
    writeFileSync(blockedFile, "x");
    const cannotPersist = createTelemetry({
      ...options,
      file: join(blockedFile, "telemetry.json"),
    });
    await cannotPersist.capture();
    expect(sent.length, "storage failures must stop reporting").toBe(3);
    expect(
      () => cannotPersist.setEnabled(false),
      "failed preference writes must not report success",
    ).toThrow();
    writeFileSync(file, "broken");
    await t.capture();
    expect(sent.length, "corrupt preference must fail closed").toBe(3);
    expect(t.settings().enabled).toBe(false);
    t.setEnabled(false);
    expect(JSON.parse(readFileSync(file, "utf8")).enabled).toBe(false);
    const shared = join(dir, "shared.json");
    const receipts = join(dir, "receipts.jsonl");
    const worker = `import {createTelemetry} from ${JSON.stringify(new URL("../../lib/telemetry.ts", import.meta.url).href)};
 import fs from 'node:fs';
 const t=createTelemetry({file:${JSON.stringify(shared)},key:'test-token',host:'https://us.i.posthog.com',version:'test',now:()=>new Date('2026-10-01T00:00:00Z'),send:async(u,i)=>{fs.appendFileSync(${JSON.stringify(receipts)},i.body+'\\n');return new Response('1');}});
 await t.capture();`;
    await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          new Promise<void>((resolve, reject) => {
            const child = spawn(process.execPath, ["--input-type=module", "-e", worker], {
              stdio: "ignore",
            });
            child.on("error", reject);
            child.on("exit", (code) =>
              code === 0 ? resolve() : reject(new Error("worker failed")),
            );
          }),
      ),
    );
    expect(
      readFileSync(receipts, "utf8").trim().split("\n").length,
      "independent processes must reserve one daily event",
    ).toBe(1);
    const crashed = join(dir, "crashed.json");
    mkdirSync(`${crashed}.days`);
    writeFileSync(join(`${crashed}.days`, "2026-09-10"), "");
    offline = false;
    await createTelemetry({ ...options, file: crashed }).capture();
    expect(sent.length).toBe(3);
    now = new Date("2026-09-11T12:00:00Z");
    await createTelemetry({ ...options, file: crashed }).capture();
    expect(sent.length, "abandoned daily claim must not block tomorrow").toBe(4);
    // Failed delivery must remain retryable, without counting a retry as another event.
    for (const failure of ["offline", "http", "quota", "invalid"]) {
      let clock = new Date("2026-11-01T12:00:00Z");
      let healthy = false;
      const attempts: EventPayload[] = [];
      const retryOptions: Options = {
        ...options,
        file: join(dir, `${failure}.json`),
        now: () => clock,
        send: async (_url, init) => {
          attempts.push(JSON.parse(String(init?.body)));
          if (healthy) return new Response('{"status":"Ok"}');
          if (failure === "offline") throw new Error("offline");
          if (failure === "http") return new Response("unavailable", { status: 503 });
          if (failure === "quota") return new Response('{"status":1,"quota_limited":["events"]}');
          return new Response("not an acknowledgement");
        },
      };
      await createTelemetry(retryOptions).capture();
      clock = new Date("2026-11-01T12:09:59Z");
      await createTelemetry(retryOptions).capture();
      expect(attempts.length, "failed requests must have a cooldown across restarts").toBe(1);
      clock = new Date("2026-11-01T12:10:00Z");
      healthy = true;
      await Promise.all(Array.from({ length: 8 }, () => createTelemetry(retryOptions).capture()));
      expect(attempts.length, `${failure} failure must retry once after the cooldown`).toBe(2);
      expect(attempts[0].uuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(
        attempts[1],
        "retries must retain the entire event, including UUID and timestamp",
      ).toStrictEqual(attempts[0]);
      clock = new Date("2026-11-01T13:00:00Z");
      await createTelemetry(retryOptions).capture();
      expect(attempts.length, "an acknowledged event must stop retrying").toBe(2);
    }
    let retryClock = new Date("2026-12-01T12:00:00Z");
    let failedAttempts = 0;
    const boundedOptions = {
      ...options,
      file: join(dir, "bounded.json"),
      now: () => retryClock,
      send: async () => {
        failedAttempts++;
        throw new Error("offline");
      },
    };
    const bounded = createTelemetry(boundedOptions);
    await bounded.capture();
    bounded.setEnabled(false);
    retryClock = new Date("2026-12-01T12:10:00Z");
    await createTelemetry(boundedOptions).capture();
    expect(failedAttempts, "opting out must stop pending retries").toBe(1);
    bounded.setEnabled(true);
    for (const time of ["12:10", "12:20", "12:30", "23:59"]) {
      retryClock = new Date(`2026-12-01T${time}:00Z`);
      await createTelemetry(boundedOptions).capture();
    }
    expect(failedAttempts, "delivery must be bounded to three attempts per UTC day").toBe(3);
    retryClock = new Date("2026-12-02T00:00:00Z");
    await createTelemetry(boundedOptions).capture();
    expect(failedAttempts, "a failed day must not block tomorrow").toBe(4);
    const retryReceipts = join(dir, "retry-receipts.jsonl");
    const retryWorker = `import {createTelemetry} from ${JSON.stringify(new URL("../../lib/telemetry.ts", import.meta.url).href)};
 import fs from 'node:fs';
 await createTelemetry({file:${JSON.stringify(join(dir, "shared-retry.json"))},key:'test-token',host:'https://us.i.posthog.com',version:'test',now:()=>new Date(process.argv[1]),send:async(u,i)=>{fs.appendFileSync(${JSON.stringify(retryReceipts)},i.body+'\\n');return new Response('1',{status:Number(process.argv[2])});}}).capture();`;
    for (const [time, status] of [
      ["12:00", 503],
      ["12:10", 200],
      ["12:20", 200],
    ]) {
      await Promise.all(
        Array.from(
          { length: 8 },
          () =>
            new Promise<void>((resolve, reject) => {
              const child = spawn(
                process.execPath,
                [
                  "--input-type=module",
                  "-e",
                  retryWorker,
                  `2026-12-03T${time}:00Z`,
                  String(status),
                ],
                { stdio: "ignore" },
              );
              child.on("error", reject);
              child.on("exit", (code) =>
                code === 0 ? resolve() : reject(new Error("retry worker failed")),
              );
            }),
        ),
      );
    }
    const retried = readFileSync(retryReceipts, "utf8")
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    expect(
      retried.length,
      "independent processes must share retry cooldowns and acknowledgement",
    ).toBe(2);
    expect(retried[0], "independent processes must retry the same event").toStrictEqual(retried[1]);
    console.log(
      "PASS: fresh-install default, minimal payload, daily limit, concurrency, restart, opt-out, bounded retries, deduplication identity, empty key, corrupt preference",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
