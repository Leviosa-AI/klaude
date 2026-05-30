import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeLogger } from "./log.js";

let tmpHome: string;
let logPath: string;
let originalMaxBytes: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "klaude-log-test-"));
  logPath = join(tmpHome, "debug.log");
  originalMaxBytes = process.env.KLAUDE_LOG_MAX_BYTES;
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalMaxBytes === undefined) {
    delete process.env.KLAUDE_LOG_MAX_BYTES;
  } else {
    process.env.KLAUDE_LOG_MAX_BYTES = originalMaxBytes;
  }
});

describe("makeLogger — basic behavior", () => {
  it("does nothing when disabled", () => {
    const log = makeLogger(false, logPath);
    log.log("hello");
    expect(existsSync(logPath)).toBe(false);
  });

  it("writes a timestamped line when enabled", () => {
    const log = makeLogger(true, logPath);
    log.log("hello", "world");
    const content = readFileSync(logPath, "utf8");
    // [2026-...] hello world
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T[\d:.Z]+\] hello world\n$/);
  });

  it("JSON-stringifies non-string parts", () => {
    const log = makeLogger(true, logPath);
    log.log("input:", { a: 1, b: [2, 3] });
    const content = readFileSync(logPath, "utf8");
    expect(content).toContain('input: {"a":1,"b":[2,3]}');
  });

  it("creates the parent directory on first write", () => {
    const nested = join(tmpHome, "deeper", "nested", "debug.log");
    const log = makeLogger(true, nested);
    log.log("first");
    expect(existsSync(nested)).toBe(true);
  });

  it("exposes the resolved path", () => {
    const log = makeLogger(true, logPath);
    expect(log.path).toBe(logPath);
  });
});

describe("makeLogger — rotation", () => {
  // Use a tiny threshold so we can trigger rotation cheaply.
  // The env var is read once when makeLogger is imported, but our impl
  // reads it on each makeLogger call via Number(), so per-test override works.
  beforeEach(() => {
    // 100 bytes — comfortably crossed by a single log line.
    process.env.KLAUDE_LOG_MAX_BYTES = "100";
  });

  it("rotates active log to .old when size crosses the threshold", () => {
    // Reload module so it picks up KLAUDE_LOG_MAX_BYTES=100.
    // The constant is captured at import time; we work around that by
    // pre-seeding the file above the threshold and calling log once.
    writeFileSync(logPath, "x".repeat(150));
    const log = makeLogger(true, logPath);
    log.log("trigger");
    expect(existsSync(`${logPath}.old`)).toBe(true);
    // The pre-seeded content moved to .old
    expect(readFileSync(`${logPath}.old`, "utf8")).toBe("x".repeat(150));
    // The fresh log has only the new line
    const fresh = readFileSync(logPath, "utf8");
    expect(fresh).toMatch(/trigger/);
    expect(fresh).not.toContain("xxxx");
  });

  it("does not rotate when below threshold", () => {
    writeFileSync(logPath, "x".repeat(50));
    const log = makeLogger(true, logPath);
    log.log("small");
    expect(existsSync(`${logPath}.old`)).toBe(false);
    const content = readFileSync(logPath, "utf8");
    expect(content).toContain("xxxx");
    expect(content).toMatch(/small/);
  });

  it("overwrites any existing .old on subsequent rotations", () => {
    // Pre-existing .old from a previous rotation
    writeFileSync(`${logPath}.old`, "ancient");
    // Active log just over threshold
    writeFileSync(logPath, "x".repeat(150));
    const log = makeLogger(true, logPath);
    log.log("rotate now");
    // .old should now hold the just-rotated content, not "ancient"
    expect(readFileSync(`${logPath}.old`, "utf8")).toBe("x".repeat(150));
  });

  it("handles ENOENT silently on first write (no prior log file)", () => {
    // No file exists yet
    expect(existsSync(logPath)).toBe(false);
    const log = makeLogger(true, logPath);
    // Should not throw; should create the file
    expect(() => log.log("first")).not.toThrow();
    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(`${logPath}.old`)).toBe(false);
  });
});
