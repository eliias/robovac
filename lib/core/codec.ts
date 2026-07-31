import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { SnapshotSchema, type Snapshot } from "./snapshot";
import { SETTINGS, type Values } from "./settings";

export interface ReportPayload {
  snap: Snapshot;
  tuned?: Partial<Values>;
}

/**
 * What went wrong, precisely enough for a full-page state:
 * empty (B3), truncated (B1, with byte counts on v2 links),
 * version (B2), invalid (B4, with the decoded payload for copy-back).
 */
export type CodecErrorKind = "empty" | "truncated" | "version" | "invalid";

export class CodecError extends Error {
  kind: CodecErrorKind;
  issues: string[];
  /** Fragment bytes that arrived (truncated only). */
  received?: number;
  /** Fragment bytes the length prefix promised (truncated v2 links only). */
  expected?: number;
  /** The decoded JSON text (invalid only), for "copy the raw payload". */
  payloadText?: string;

  constructor(
    kind: CodecErrorKind,
    issues: string[],
    extra?: { received?: number; expected?: number; payloadText?: string },
  ) {
    super("invalid report link: " + issues.join("; "));
    this.name = "CodecError";
    this.kind = kind;
    this.issues = issues;
    this.received = extra?.received;
    this.expected = extra?.expected;
    this.payloadText = extra?.payloadText;
  }
}

// v2 prepends the payload length in base36, so a truncated link can say how
// much is missing. v1 links (no length) still decode.
const CODEC_VERSION = "2";

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replaceAll("-", "+").replaceAll("_", "/");
  const bin =
    typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodeReport(payload: ReportPayload): string {
  const body: ReportPayload = { snap: payload.snap };
  if (payload.tuned && Object.keys(payload.tuned).length > 0) body.tuned = payload.tuned;
  const data = b64urlEncode(deflateSync(strToU8(JSON.stringify(body))));
  return CODEC_VERSION + "." + data.length.toString(36) + "." + data;
}

export function decodeReport(fragment: string): ReportPayload {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!raw) throw new CodecError("empty", ["the fragment is empty"]);
  const dot = raw.indexOf(".");
  if (dot < 1) throw new CodecError("truncated", ["the fragment has no codec version prefix"]);
  const version = raw.slice(0, dot);

  let data: string;
  if (version === "1") {
    data = raw.slice(dot + 1);
  } else if (version === "2") {
    const rest = raw.slice(dot + 1);
    const dot2 = rest.indexOf(".");
    if (dot2 < 1) {
      throw new CodecError("truncated", ["the fragment lost its length prefix"], {
        received: rest.length,
      });
    }
    const expected = parseInt(rest.slice(0, dot2), 36);
    data = rest.slice(dot2 + 1);
    if (!Number.isFinite(expected) || data.length < expected) {
      throw new CodecError(
        "truncated",
        [`the fragment carries ${data.length} of ${expected} bytes`],
        { received: data.length, expected },
      );
    }
  } else {
    throw new CodecError("version", [`unknown codec version "${version}"`]);
  }

  let payloadText: string;
  try {
    payloadText = strFromU8(inflateSync(b64urlDecode(data)));
  } catch {
    throw new CodecError(
      "truncated",
      ["the fragment does not decode; the link is truncated or damaged"],
      { received: data.length },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    throw new CodecError("truncated", ["the payload is not valid JSON"], {
      received: data.length,
    });
  }

  if (typeof parsed !== "object" || parsed === null || !("snap" in parsed)) {
    throw new CodecError("invalid", ["the payload has no snapshot"], { payloadText });
  }
  const candidate = parsed as { snap: unknown; tuned?: unknown };

  const result = SnapshotSchema.safeParse(candidate.snap);
  if (!result.success) {
    throw new CodecError(
      "invalid",
      result.error.issues.map((i) => `${i.path.join(".") || "snapshot"}: ${i.message}`),
      { payloadText },
    );
  }

  let tuned: Partial<Values> | undefined;
  if (candidate.tuned !== undefined) {
    if (typeof candidate.tuned !== "object" || candidate.tuned === null) {
      throw new CodecError("invalid", ["tuned values are not an object"], { payloadText });
    }
    tuned = {};
    const issues: string[] = [];
    for (const [key, value] of Object.entries(candidate.tuned)) {
      const def = SETTINGS.find((d) => d.key === key);
      if (!def) issues.push(`unknown tuned setting ${key}`);
      else if (typeof value !== "number" || value < def.min || value > def.max) {
        issues.push(`tuned ${key} = ${String(value)} outside [${def.min}, ${def.max}]`);
      } else tuned[key] = value;
    }
    if (issues.length) throw new CodecError("invalid", issues, { payloadText });
  }

  return tuned ? { snap: result.data, tuned } : { snap: result.data };
}
