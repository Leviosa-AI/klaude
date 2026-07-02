import { describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { HAIKU_MODEL, validateConfig } from "./config.js";

const VALID: Config = {
  backend: { kind: "haiku", model: HAIKU_MODEL },
  sourceLang: "ko",
  targetLang: "en",
  debug: false,
  glossary: [["베가베리", "Vegavery"]],
};

describe("validateConfig", () => {
  it("accepts a valid haiku config", () => {
    expect(validateConfig(VALID)).toBe(VALID);
  });

  it("accepts a valid ollama config", () => {
    const cfg: Config = {
      ...VALID,
      backend: { kind: "ollama", model: "gemma3:4b", host: "http://localhost:11434" },
    };
    expect(validateConfig(cfg)).toBe(cfg);
  });

  it("accepts a config without the optional glossary", () => {
    const { glossary: _drop, ...rest } = VALID;
    expect(() => validateConfig(rest)).not.toThrow();
  });

  it("names the bad key for a typo'd backend kind", () => {
    const cfg = { ...VALID, backend: { kind: "olama", model: "gemma3:4b" } };
    expect(() => validateConfig(cfg)).toThrow(/backend\.kind/);
  });

  it("rejects a non-object backend", () => {
    expect(() => validateConfig({ ...VALID, backend: "haiku" })).toThrow(/"backend"/);
  });

  it("rejects an empty model", () => {
    const cfg = { ...VALID, backend: { kind: "haiku", model: "" } };
    expect(() => validateConfig(cfg)).toThrow(/backend\.model/);
  });

  it("requires a host for the ollama backend", () => {
    const cfg = { ...VALID, backend: { kind: "ollama", model: "gemma3:4b" } };
    expect(() => validateConfig(cfg)).toThrow(/backend\.host/);
  });

  it("rejects non-string languages", () => {
    expect(() => validateConfig({ ...VALID, sourceLang: 3 })).toThrow(/sourceLang/);
    expect(() => validateConfig({ ...VALID, targetLang: "" })).toThrow(/targetLang/);
  });

  it('rejects a non-boolean debug (e.g. the string "true")', () => {
    expect(() => validateConfig({ ...VALID, debug: "true" })).toThrow(/"debug"/);
  });

  it("rejects malformed glossary entries", () => {
    expect(() => validateConfig({ ...VALID, glossary: "not-an-array" })).toThrow(
      /glossary/,
    );
    expect(() => validateConfig({ ...VALID, glossary: [["only-one"]] })).toThrow(
      /glossary/,
    );
    expect(() => validateConfig({ ...VALID, glossary: [["ko", 42]] })).toThrow(
      /glossary/,
    );
  });

  it("error message tells the user how to recover", () => {
    expect(() => validateConfig({ ...VALID, debug: 1 })).toThrow(/delete it to reset/);
  });
});
