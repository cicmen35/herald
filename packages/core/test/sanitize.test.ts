import { describe, expect, it } from "vitest";
import { looksUnsafeForSpeech, sanitizeForSpeech, spokenOrFallback } from "../src/sanitize.js";

describe("sanitizeForSpeech", () => {
  it("accepts a short spoken sentence", () => {
    const r = sanitizeForSpeech("The auth refactor is done and tests pass.");
    expect(r.ok).toBe(true);
  });

  it("rejects paths, urls, hashes, and backticks", () => {
    expect(looksUnsafeForSpeech("see src/middleware/auth.ts")).toBe("path");
    expect(looksUnsafeForSpeech("open https://github.com/acme/app")).toBe("url");
    expect(looksUnsafeForSpeech("commit abcdef1234567")).toBe("hash");
    expect(looksUnsafeForSpeech("the `billing` module")).toBe("backticks");
  });

  it("falls back instead of speaking artifacts", () => {
    expect(spokenOrFallback("edit src/foo.ts", "Agent two")).toBe("Agent two finished.");
  });
});
