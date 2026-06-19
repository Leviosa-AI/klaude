import { describe, expect, it } from "vitest";
import { isLocalHost } from "./ollama.js";

describe("isLocalHost", () => {
  it("recognizes localhost variants we can auto-start a server for", () => {
    expect(isLocalHost("http://localhost:11434")).toBe(true);
    expect(isLocalHost("http://127.0.0.1:11434")).toBe(true);
    expect(isLocalHost("http://[::1]:11434")).toBe(true);
    expect(isLocalHost("https://localhost")).toBe(true);
  });

  it("rejects remote hosts we cannot start a daemon for", () => {
    expect(isLocalHost("http://192.168.0.10:11434")).toBe(false);
    expect(isLocalHost("http://ollama.internal:11434")).toBe(false);
    expect(isLocalHost("https://example.com")).toBe(false);
  });

  it("rejects malformed hosts without throwing", () => {
    expect(isLocalHost("not a url")).toBe(false);
    expect(isLocalHost("")).toBe(false);
  });
});
