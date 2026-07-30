import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { SnapshotSchema, type Snapshot } from "./snapshot";
import { SETTINGS, type Values } from "./settings";

export interface ReportPayload {
  snap: Snapshot;
  tuned?: Partial<Values>;
}

export class CodecError extends Error {
  issues: string[];

  constructor(issues: string[]) {
    super("invalid report link: " + issues.join("; "));
    this.name = "CodecError";
    this.issues = issues;
  }
}

const CODEC_VERSION = "1";

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
  const bytes = deflateSync(strToU8(JSON.stringify(body)));
  return CODEC_VERSION + "." + b64urlEncode(bytes);
}

export function decodeReport(fragment: string): ReportPayload {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const dot = raw.indexOf(".");
  if (dot < 1) throw new CodecError(["the fragment has no codec version prefix"]);
  const version = raw.slice(0, dot);
  if (version !== CODEC_VERSION) throw new CodecError([`unknown codec version "${version}"`]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(inflateSync(b64urlDecode(raw.slice(dot + 1)))));
  } catch {
    throw new CodecError(["the fragment does not decode; the link is truncated or damaged"]);
  }

  if (typeof parsed !== "object" || parsed === null || !("snap" in parsed)) {
    throw new CodecError(["the payload has no snapshot"]);
  }
  const candidate = parsed as { snap: unknown; tuned?: unknown };

  const result = SnapshotSchema.safeParse(candidate.snap);
  if (!result.success) {
    throw new CodecError(
      result.error.issues.map((i) => `${i.path.join(".") || "snapshot"}: ${i.message}`),
    );
  }

  let tuned: Partial<Values> | undefined;
  if (candidate.tuned !== undefined) {
    if (typeof candidate.tuned !== "object" || candidate.tuned === null) {
      throw new CodecError(["tuned values are not an object"]);
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
    if (issues.length) throw new CodecError(issues);
  }

  return tuned ? { snap: result.data, tuned } : { snap: result.data };
}
