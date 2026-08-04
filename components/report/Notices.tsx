"use client";

import { C, MONO } from "@/components/ui";
import { fmtCompact, fmtInt, fmtSecs } from "@/lib/core/format";
import type { Reading } from "@/lib/core/reading";
import type { Snapshot } from "@/lib/core/snapshot";
import { NoticeBar } from "./states";

/** The snapshot's own timestamp, the way every notice prints it. */
export function snapshotLabel(snap: Snapshot): string {
  return new Date(snap.capturedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/**
 * The degraded-state notices (D1-D6), above the report they degrade. Which
 * ones apply is decided by reading(); this file only says them. The report
 * still renders below: a missing input degrades it, it does not replace it.
 */
export function Notices({
  snap,
  read,
  expiresInDays,
}: {
  snap: Snapshot;
  read: Reading;
  /** Set by /r/[id]. Absent on a permalink, which never expires. */
  expiresInDays?: number;
}) {
  const { state, deadRateUnknown, estimated, stale, small, neverVacuumed, ageDays } = read;
  const any =
    expiresInDays !== undefined || deadRateUnknown || estimated || stale || small || neverVacuumed;
  if (!any) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 16 }}>
      {expiresInDays !== undefined && (
        <NoticeBar
          severity="neutral"
          title="short link"
          body={`This link stops working in ${expiresInDays} ${
            expiresInDays === 1 ? "day" : "days"
          }. The permalink in the MCP result has no expiry. Keep that one if you file this somewhere.`}
        />
      )}
      {state === "reset" && snap.countersReset && (
        <NoticeBar
          severity="neutral"
          title="Counters went backwards. Rates unknown."
          body={
            <>
              <span style={{ fontFamily: MONO, color: C.strong }}>
                {snap.countersReset.counter}
              </span>{" "}
              fell from {fmtInt(snap.countersReset.first)} to {fmtInt(snap.countersReset.second)}{" "}
              between the two samples, so pg_stat_reset() ran, the server restarted, or the two
              samples came from different servers. Everything not derived from a rate is still
              exact.
            </>
          }
          action={{ label: "take two fresh samples", href: "/" }}
        />
      )}
      {state === "single" && deadRateUnknown && (
        <NoticeBar
          severity="neutral"
          title="One sample. Rates unknown."
          body="Dead-tuple rate, xid consumption rate, and everything derived from them (days to the next vacuum, days to the freeze limit, shutdown margin) need two readings. Thresholds, sizes, current settings and the proposed values below are computed from this one."
          action={{ label: "add a second sample", href: "/" }}
        />
      )}
      {estimated && (
        <NoticeBar
          severity="neutral"
          title={`${fmtSecs(snap.sampleSeconds ?? 0)} between samples. Rates are noise.`}
          body="At this interval a single checkpoint or one background job dominates the delta. Run the query again 30-60 s apart; the rates shown until then are marked estimated and are not used for the proposals."
          action={{ label: "re-run the query", href: "/" }}
        />
      )}
      {stale && (
        <NoticeBar
          severity="neutral"
          title={`Snapshot is ${Math.floor(ageDays)} days old.`}
          body={
            <>
              Figures below describe the table as of {snapshotLabel(snap)}.
              {!deadRateUnknown && !estimated && (
                <>
                  {" "}
                  At the write rate it recorded, xid age has since advanced by roughly{" "}
                  {fmtCompact(Math.round(ageDays * snap.xidPerDay))}
                  {snap.xidAge + ageDays * snap.xidPerDay >
                    snap.proposed.autovacuum_freeze_max_age &&
                    ", past the freeze limit this report proposes"}
                  .
                </>
              )}
            </>
          }
          action={{ label: "re-run the query", href: "/" }}
        />
      )}
      {small && (
        <NoticeBar
          severity="neutral"
          title={`${fmtInt(snap.live)} live rows. The defaults are correct here.`}
          body="At this size autovacuum fires on the 50-row floor long before any scale factor matters, and a full pass costs under a second. Nothing on this table is worth changing. The sliders and charts below are live if you want to see why."
          action={{ label: "snapshot another table", href: "/" }}
        />
      )}
      {neverVacuumed &&
        (snap.autovacuumOff ? (
          <NoticeBar
            severity="neutral"
            title="Autovacuum is off for this table."
            body="reloptions carry autovacuum_enabled = false. That is the answer, not a hint: nothing below runs until it is enabled again."
          />
        ) : (
          <NoticeBar
            severity="neutral"
            title="Autovacuum has never run on this table."
            body="Either the table has not yet reached its trigger threshold, autovacuum is off for it in reloptions, or statistics were reset since the last run. The first is expected on a young table; the second is shown in the trigger group below."
          />
        ))}
    </div>
  );
}
