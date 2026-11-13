"use client";

/**
 * Content-verified duplicates (read-only view of cil-dupverify results).
 *
 * Distinct from the probable name + size matches: every set here is a
 * group of distinct files (inodes) whose full contents hashed identically
 * when they were read. Still evidence, not instruction — the only action is
 * the same per-copy checkbox the probable view has, which feeds the normal
 * target → review → manifest flow. There is deliberately no "select all
 * but one" shortcut, and hard links are marked because removing one frees
 * nothing.
 */

import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hkApi } from "@/lib/hk";
import { GridLoader } from "@/components/ui/grid-loader";
import { formatBytes } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";
import type { FindRow } from "@/components/housekeeping-find";

const vapi = (path: string) => hkApi(`/verified-duplicates${path}`);

type VFile = { path: string; owner: string | null; inode: number; nlink: number;
               allocated_bytes: number; sparse: boolean; in_root: boolean };
type VSet = { group_id: string; blake3: string; size: number; copies: number; byte_verified: boolean;
              external_links: boolean; snapshot_date: string; verified_at: string; run_id: string;
              potential_logical_bytes: number; potential_allocated_bytes: number | null;
              paths_total: number; paths_truncated: boolean; owners: string[]; files: VFile[] };

const STATUS_LABEL: Record<string, string> = {
  complete: "verified (complete)",
  incomplete: "incomplete — stopped by budget or interruption; nothing counted",
  deferred: "deferred — too large for the run's limits; not read",
  skipped: "nothing to compare (zero-size, links only, unreadable)",
};

export function VerifiedDuplicates({ root, selected, toggle }: {
  root: string; selected: Map<string, FindRow>;
  toggle: (row: FindRow, source: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<"incomplete" | "deferred" | "skipped" | null>(null);
  const q = encodeURIComponent(root);
  const status = useQuery({ queryKey: ["dupv-status", root], queryFn: () => vapi(`/status?root=${q}`) });
  const sets = useQuery({ queryKey: ["dupv-sets", root], queryFn: () => vapi(`/sets?root=${q}`),
                          enabled: !!status.data?.available });
  const pend = useQuery({ queryKey: ["dupv-pending", root, pending],
                          queryFn: () => vapi(`/pending?root=${q}&status=${pending}`), enabled: !!pending });

  if (status.isLoading) return <div className="py-8 flex justify-center"><GridLoader label="Loading verification results" /></div>;
  if (status.isError) return <div className="text-xs text-red-600">Could not load verification results.</div>;
  if (!status.data?.available) {
    return (
      <div className="text-[11px] px-2.5 py-2 rounded border border-border/60 bg-muted/20 text-muted-foreground">
        No content verification has been imported yet. Verification is a separate, explicitly
        requested read-only job (cil-dupverify) — the weekly scan only records metadata, so until a
        run is imported every duplicate shown in this tool is a probable match.
      </div>
    );
  }

  const s = status.data;
  const latestVerifiedSnap: string | undefined = s.verified.snapshot_dates?.[1];
  const stale = latestVerifiedSnap && s.current_snapshot && latestVerifiedSnap < s.current_snapshot;
  const groups = s.groups as Record<string, { groups: number; files: number; bytes: number }>;

  return (
    <>
      <div className="text-[11px] px-2.5 py-1.5 rounded border border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300">
        {sets.data?.caveat ?? "Verified sets are files whose full contents were identical when read."}
        {" "}Checkboxes are on individual copies only; hard links (same inode) are marked — selecting
        one frees no space.
      </div>
      {stale && (
        <div className="text-[11px] px-2.5 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          These results were verified against the {latestVerifiedSnap} snapshot; the current snapshot is{" "}
          {s.current_snapshot}. Files may have changed since — re-verify before relying on them.
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span><b className="font-mono">{s.verified.sets}</b> verified sets</span>
        <span><b className="font-mono">{s.verified.copies}</b> distinct copies</span>
        <span title="(copies − 1) × size, summed — an upper bound">
          up to <b className="font-mono">{formatBytes(s.verified.potential_logical_bytes)}</b> in extra copies
        </span>
        {s.verified.last_verified_at && <span className="text-muted-foreground">last verified {s.verified.last_verified_at} UTC</span>}
      </div>

      <div className="flex flex-wrap gap-2 text-[11px]">
        {(["complete", "incomplete", "deferred", "skipped"] as const).map((k) => {
          const g = groups[k];
          if (!g) return null;
          const clickable = k !== "complete";
          return (
            <button key={k} disabled={!clickable} title={STATUS_LABEL[k]}
                    onClick={() => clickable && setPending(pending === k ? null : (k as any))}
                    className={cn("px-2 py-0.5 rounded border font-mono",
                      k === "complete" ? "border-emerald-600/40" : "border-border/60 hover:bg-muted/30",
                      pending === k && "bg-muted/40")}>
              {k}: {g.groups} groups · {g.files} files
            </button>
          );
        })}
      </div>

      {pending && (
        <div className="border border-border/40 rounded p-2">
          <div className="text-[11px] text-muted-foreground mb-1">{STATUS_LABEL[pending]}</div>
          {pend.isLoading ? <GridLoader label="Loading groups" /> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                <th className="px-2 py-1 text-right">Size each</th><th className="px-2 py-1 text-right">Files</th>
                <th className="px-2 py-1">Why</th><th className="px-2 py-1">Run</th>
              </tr></thead>
              <tbody>
                {(pend.data?.rows ?? []).map((g: any) => (
                  <tr key={g.group_id} className="border-b border-border/20">
                    <td className="px-2 py-1 text-right font-mono">{formatBytes(g.size)}</td>
                    <td className="px-2 py-1 text-right font-mono">{g.files}</td>
                    <td className="px-2 py-1">
                      {g.note ?? ""}{" "}
                      {Object.entries(g.skip_reasons ?? {}).map(([r, n]) => `${r.replace(/_/g, " ")} ×${n}`).join(", ")}
                    </td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{g.verified_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {sets.isLoading ? <GridLoader label="Loading verified sets" /> : (
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground border-b border-border/40">
            <th className="w-6"></th>
            <th className="px-2 py-1.5">Content (BLAKE3)</th>
            <th className="px-2 py-1.5 text-right">Size each</th>
            <th className="px-2 py-1.5 text-right" title="Distinct files (inodes); hard links count once">Copies</th>
            <th className="px-2 py-1.5 text-right" title="(copies − 1) × size. An upper bound: snapshots, quotas, compression and outside links are not modelled">Potential (upper bound)</th>
            <th className="px-2 py-1.5">Owners</th>
            <th className="px-2 py-1.5">Verified</th>
          </tr></thead>
          <tbody>
            {(sets.data?.rows ?? []).map((r: VSet) => {
              const key = r.group_id + r.blake3;
              const inodeCount = new Map<number, number>();
              r.files.forEach((f) => inodeCount.set(f.inode, (inodeCount.get(f.inode) ?? 0) + 1));
              return (
                <Fragment key={key}>
                  <tr className="border-b border-border/20 hover:bg-muted/20">
                    <td className="px-1 py-1">
                      <button className="text-muted-foreground hover:text-foreground"
                              onClick={() => setOpen(open === key ? null : key)}>{open === key ? "▾" : "▸"}</button>
                    </td>
                    <td className="px-2 py-1 font-mono" title={r.blake3}>
                      {r.blake3.slice(0, 12)}…
                      {r.byte_verified && <span className="ml-1 text-emerald-700 dark:text-emerald-400" title="Also compared byte for byte">✓bytes</span>}
                      {r.external_links && <span className="ml-1 text-amber-600" title="Some copy has hard links outside this set">⚠links</span>}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{formatBytes(r.size)}</td>
                    <td className="px-2 py-1 text-right font-mono">×{r.copies}</td>
                    <td className="px-2 py-1 text-right font-mono font-semibold"
                        title={r.potential_allocated_bytes != null ? `allocated blocks: ${formatBytes(r.potential_allocated_bytes)}` : undefined}>
                      {formatBytes(r.potential_logical_bytes)}
                    </td>
                    <td className="px-2 py-1 font-mono">{r.owners.join(", ")}</td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{r.verified_at.slice(0, 10)}</td>
                  </tr>
                  {open === key && (
                    <tr>
                      <td colSpan={7} className="border-b border-border/30 bg-muted/10 px-3 py-2">
                        {r.files.map((f) => {
                          const linked = (inodeCount.get(f.inode) ?? 0) > 1 || f.nlink > 1;
                          return (
                            <div key={f.path} className={cn("flex items-center gap-2 font-mono text-[11px]", !f.in_root && "opacity-60")}>
                              <input type="checkbox" checked={selected.has(f.path)} disabled={!f.in_root}
                                     title={f.in_root ? undefined : "Outside the current root"}
                                     onChange={() => toggle(
                                       { path: f.path, bytes: r.size, files: 1, kind: "file", owner: f.owner },
                                       `find:dup-verified:${r.blake3.slice(0, 16)}`)} />
                              <span className="truncate" title={f.path}>{f.path}</span>
                              <span className="text-muted-foreground">({f.owner ?? "?"})</span>
                              <span className="text-muted-foreground">inode {f.inode}</span>
                              {linked && <span className="text-amber-600" title={`${f.nlink} links to this inode`}>hard link ×{f.nlink}</span>}
                              {f.sparse && <span className="text-muted-foreground" title="Allocates less than its size">sparse</span>}
                            </div>
                          );
                        })}
                        {r.paths_truncated && (
                          <div className="text-[11px] text-muted-foreground mt-1">
                            {r.paths_total - r.files.length} more paths not listed.
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {(s.runs ?? []).length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-muted-foreground">Verification runs ({s.runs.length})</summary>
          <table className="w-full mt-1">
            <thead><tr className="text-left text-muted-foreground border-b border-border/40">
              <th className="px-2 py-1">Started (UTC)</th><th className="px-2 py-1">Snapshot</th>
              <th className="px-2 py-1">Outcome</th><th className="px-2 py-1 text-right">Groups ✓ / incomplete / deferred</th>
              <th className="px-2 py-1 text-right">Read</th><th className="px-2 py-1 text-right">Elapsed</th>
            </tr></thead>
            <tbody>
              {s.runs.map((r: any) => (
                <tr key={r.run_id} className="border-b border-border/20 font-mono">
                  <td className="px-2 py-1">{r.started_at}</td>
                  <td className="px-2 py-1">{r.snapshot_date}</td>
                  <td className={cn("px-2 py-1", r.stopped && "text-amber-600")}>
                    {r.stopped ? (r.stopped === "no_summary" ? "ended abnormally" : `stopped: ${r.stopped}`) : "finished"}
                  </td>
                  <td className="px-2 py-1 text-right">{r.groups_complete} / {r.groups_incomplete} / {r.groups_deferred}</td>
                  <td className="px-2 py-1 text-right">{formatBytes(r.bytes_read)}</td>
                  <td className="px-2 py-1 text-right">{Math.round(r.elapsed_s)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}
