const PATH_LIKE = /(?:^|[\s`'"(])(?:\/[\w.-]+)+\.[A-Za-z0-9]{1,8}\b|(?:^|[\s`'"(])(?:src|lib|apps|packages|dist)\/[\w./-]+/i;
const BACKTICKS = /`[^`]+`/;
const URL_LIKE = /https?:\/\/\S+|www\.\S+/i;
const HEX_HASH = /\b[a-f0-9]{7,40}\b/i;
const LONG_IDENT = /\b[A-Za-z][A-Za-z0-9_-]{2,}(?:[./][A-Za-z0-9_-]+){2,}\b/;
const JSON_BLOB = /[{[][\s\S]{20,}[}\]]/;

export type SanitizeResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export function looksUnsafeForSpeech(text: string): string | null {
  if (BACKTICKS.test(text)) return "backticks";
  if (URL_LIKE.test(text)) return "url";
  if (PATH_LIKE.test(text)) return "path";
  if (HEX_HASH.test(text)) return "hash";
  if (LONG_IDENT.test(text)) return "identifier";
  if (JSON_BLOB.test(text)) return "json";
  return null;
}

/** Every string headed to TTS must pass through here. */
export function sanitizeForSpeech(text: string): SanitizeResult {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  const reason = looksUnsafeForSpeech(trimmed);
  if (reason) return { ok: false, reason };
  return { ok: true, text: trimmed };
}

export function safeFallbackLine(agentLabel = "An agent"): string {
  return `${agentLabel} finished.`;
}

export function spokenOrFallback(text: string, agentLabel?: string): string {
  const result = sanitizeForSpeech(text);
  return result.ok ? result.text : safeFallbackLine(agentLabel);
}

/** Like spokenOrFallback, but the caller supplies the safe line (for non-worker sources). */
export function spokenOrElse(text: string, fallback: string): string {
  const result = sanitizeForSpeech(text);
  return result.ok ? result.text : fallback;
}
