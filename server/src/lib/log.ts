/**
 * Minimal structured logger that redacts secrets. Never pass raw request
 * bodies, passwords, tokens or full upstream URLs to it.
 */
const SECRET_KEYS = /pass(word)?|token|secret|authorization|cookie|code|key/i;
const TOKEN_IN_TEXT = /(access_token|client_secret|code)=([^&\s"]+)/gi;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (typeof value === "string") return value.replace(TOKEN_IN_TEXT, "$1=[redacted]");
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

function write(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level !== "error" && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(meta ? (redact(meta) as object) : {}) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
  redact,
};
