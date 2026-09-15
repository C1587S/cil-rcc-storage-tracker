"use client";

/**
 * Housekeeping report table: the working surface of the review process.
 *
 * - Persistent headroom banner: nobody should have to attempt an archive
 *   to discover cds3 is full.
 * - Headline numbers include decided-but-not-executed explicitly — the gap
 *   someone chases weekly is a number on screen, not mental subtraction.
 * - CSV export = same query, round-trippable from day one.
 * - Inline verdict dropdown writes ONE event and nothing else: no drafts,
 *   no batches, no optimistic state that can diverge from the server.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Plus } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { API_BASE_URL } from "@/lib/api";
import { formatBytes } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";
import { ReconPanel } from "@/components/housekeeping-recon";
import { toast, currentIdentity } from "@/lib/hk";
import { GridLoader } from "@/components/ui/grid-loader";

const ROOTS = ["/cds3/cil", "/project/cil"];
const VERDICTS = ["keep", "delete", "quarantine", "archive", "compress", "needs_info", "not_mine"];

type Row = Record<string, any>;

async function api(path: string, opts: RequestInit = {}, user?: string | null) {
  // Identity is resolved HERE, at call time — the per-call `user` argument
  // is only a fallback for tests. No call site can forget it.
  const uid = user ?? currentIdentity();
  const res = await fetch(`${API_BASE_URL}/api/housekeeping${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
      ...(uid ? { "X-User": uid } : {}),
    },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    // Internal detail goes to the console; the thrown message is what the
    // panel shows the person.
    console.error(`housekeeping API ${res.status} ${path}:`, detail?.detail || detail);
    throw new Error(detail?.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

function Headline({ label, tb, emphasize }: { label: string; tb: number; emphasize?: boolean }) {
  return (
    <div className={cn(
      "px-4 py-2.5 rounded-md border",
      emphasize ? "border-amber-500/50 bg-amber-500/10" : "border-border/60 bg-card"
    )}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold font-mono", emphasize && "text-amber-600 dark:text-amber-400")}>
        {tb.toFixed(2)} <span className="text-xs font-normal text-muted-foreground">TB</span>
      </div>
    </div>
  );
}

export function HousekeepingView() {
  const { currentUser, referencePath } = useAppStore();
  const qc = useQueryClient();
  // ONE root for the whole page: the global root badge (snapshot bar).
  // referencePath may point at a subdirectory (tree reference feature), so
  // resolve it to its storage root.
  const globalRoot =
    ["/project/cil", "/cds3/cil"].find(r =>
      (referencePath || "/project/cil") === r || (referencePath || "").startsWith(r + "/"))
    ?? "/project/cil";
  const [rootFilter, setRootFilter] = useState<string | null>(globalRoot);
  // The table's root chips follow the global root when it changes; they
  // remain a TABLE filter (incl. "all"), never the page's root.
  useEffect(() => { setRootFilter(globalRoot); }, [globalRoot]);
  const [textFilter, setTextFilter] = useState("");
  const [sortKey, setSortKey] = useState<string>("bytes");
  const [sortDesc, setSortDesc] = useState(true);
  const [showNewTarget, setShowNewTarget] = useState(false);
  const [execDrawer, setExecDrawer] = useState<number | null>(null);
  const [newTarget, setNewTarget] = useState({ name: "", path: "", root: "/cds3/cil", scope: "subtree" });

  const { data: headroom } = useQuery({
    queryKey: ["hk-headroom"],
    queryFn: () => api("/archive-headroom"),
    staleTime: 5 * 60 * 1000,
  });

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["hk-report", rootFilter],
    queryFn: () => api(`/report${rootFilter ? `?root=${encodeURIComponent(rootFilter)}` : ""}`),
  });

  const decide = useMutation({
    mutationFn: ({ targetId, verdict }: { targetId: number; verdict: string }) => {
      if (verdict === "archive") {
        return Promise.reject(new Error(
          "Archive needs a destination and is disabled while /cds3/cil has no headroom."));
      }
      const destination_path: string | null = null;
      return api("/decisions", {
        method: "POST",
        body: JSON.stringify({ target_id: targetId, verdict, destination_path }),
      }, currentUser);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["hk-report"] }),
    onError: (e: Error) => toast(e.message, "error"),
  });

  const createTarget = useMutation({
    mutationFn: () => api("/targets", {
      method: "POST",
      body: JSON.stringify({ ...newTarget, campaign: newTarget.root === "/cds3/cil" ? "cds3-clear" : null }),
    }, currentUser),
    onSuccess: () => {
      setShowNewTarget(false);
      setNewTarget({ name: "", path: "", root: "/cds3/cil", scope: "subtree" });
      qc.invalidateQueries({ queryKey: ["hk-report"] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const rows: Row[] = useMemo(() => {
    let r = report?.rows ?? [];
    const t = textFilter.trim().toLowerCase();
    if (t) {
      r = r.filter((x: Row) =>
        [x.name, x.path, x.assignee, x.verdict, x.created_by]
          .some(v => v && String(v).toLowerCase().includes(t)));
    }
    return [...r].sort((a, b) => {
      const av = a[sortKey] ?? "", bv = b[sortKey] ?? "";
      const cmp = typeof av === "number" || typeof bv === "number"
        ? (Number(av) || 0) - (Number(bv) || 0)
        : String(av).localeCompare(String(bv));
      return sortDesc ? -cmp : cmp;
    });
  }, [report, textFilter, sortKey, sortDesc]);

  const downloadCsv = async () => {
    const res = await fetch(
      `${API_BASE_URL}/api/housekeeping/report.csv${rootFilter ? `?root=${encodeURIComponent(rootFilter)}` : ""}`,
      { headers: (currentUser ?? currentIdentity()) ? { "X-User": (currentUser ?? currentIdentity())! } : {} },
    );
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get("Content-Disposition")?.match(/filename=(.+)/)?.[1] || "housekeeping.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sortBtn = (key: string, label: string) => (
    <button
      className="flex items-center gap-1 hover:text-foreground"
      onClick={() => { sortKey === key ? setSortDesc(!sortDesc) : (setSortKey(key), setSortDesc(true)); }}
    >
      {label}{sortKey === key ? (sortDesc ? " ↓" : " ↑") : ""}
    </button>
  );

  const h = report?.headline;

  return (
    <div className="space-y-4">
      {/* Persistent headroom banner — visible regardless of what the user is doing */}
      {headroom && (
        <div className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-md border text-xs",
          headroom.archive_available
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400"
        )}>
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            <strong>{headroom.destination}</strong>: {formatBytes(headroom.free_bytes)} free of{" "}
            {formatBytes(headroom.quota_bytes)}
            {!headroom.archive_available && " — effectively full; archive verdict disabled until it has headroom"}
          </span>
        </div>
      )}

      {/* Headline numbers */}
      {h && (
        <div className="flex flex-wrap gap-3">
          <div className="px-4 py-2.5 rounded-md border border-border/60 bg-card">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Targets</div>
            <div className="text-lg font-semibold font-mono">{h.targets}</div>
          </div>
          <Headline label="Assigned" tb={h.assigned_tb} />
          <Headline label="Decided" tb={h.decided_tb} />
          <Headline label="Decided, not executed" tb={h.decided_not_executed_tb} emphasize />
          <Headline label="Executed" tb={h.executed_tb} />
          <Headline label="Verified" tb={h.verified_tb} />
        </div>
      )}

      <StoryLookup />

      {/* Reconnaissance first: see where the problem is before deciding.
          All panels read the ONE global root from the snapshot-bar badge. */}
      <ReconPanel root={globalRoot} />

      <CandidatesPanel root={globalRoot}
                       onAdopted={() => qc.invalidateQueries({ queryKey: ["hk-report"] })} />

      <SweepPanel root={globalRoot}
                  onSwept={() => qc.invalidateQueries({ queryKey: ["hk-report"] })} />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border overflow-hidden text-xs">
          {[null, ...ROOTS].map(r => (
            <button
              key={r ?? "all"}
              className={cn("px-3 h-8 transition-colors",
                rootFilter === r ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}
              onClick={() => setRootFilter(r)}
            >
              {r ? r.split("/")[1] : "all"}
            </button>
          ))}
        </div>
        <input
          className="h-8 px-3 text-xs rounded-md border border-border bg-transparent w-56"
          placeholder="Filter name, path, assignee…"
          value={textFilter}
          onChange={e => setTextFilter(e.target.value)}
        />
        <button
          className="h-8 px-3 text-xs rounded-md border border-border flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => setShowNewTarget(v => !v)}
        >
          <Plus size={13} /> New target
        </button>
        <div className="ml-auto flex items-center gap-2">
          <UploadPanel onApplied={() => qc.invalidateQueries({ queryKey: ["hk-report"] })} />
          <button
            className="h-8 px-3 text-xs rounded-md border border-border flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={downloadCsv}
          >
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {/* Minimal target creation (hand-created targets, step 3) */}
      {showNewTarget && (
        <div className="flex flex-wrap items-end gap-2 p-3 rounded-md border border-border/60 bg-card text-xs">
          <label className="flex flex-col gap-1">Name
            <input className="h-8 px-2 rounded border border-border bg-transparent w-52"
                   value={newTarget.name} onChange={e => setNewTarget({ ...newTarget, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">Root
            <select className="h-8 px-2 rounded border border-border bg-transparent"
                    value={newTarget.root}
                    onChange={e => setNewTarget({ ...newTarget, root: e.target.value, path: "" })}>
              {ROOTS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">Path (under root)
            <input className="h-8 px-2 rounded border border-border bg-transparent w-80 font-mono"
                   placeholder={`${newTarget.root}/...`}
                   value={newTarget.path} onChange={e => setNewTarget({ ...newTarget, path: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">Scope
            <select className="h-8 px-2 rounded border border-border bg-transparent"
                    value={newTarget.scope} onChange={e => setNewTarget({ ...newTarget, scope: e.target.value })}>
              <option value="subtree">subtree</option>
              <option value="shallow">shallow</option>
              <option value="single_file">single file</option>
            </select>
          </label>
          <button
            className="h-8 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50"
            disabled={!newTarget.name || !newTarget.path || createTarget.isPending}
            onClick={() => createTarget.mutate()}
          >
            {createTarget.isPending ? "Resolving…" : "Create"}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="border border-border/60 rounded-md overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/60 text-muted-foreground text-left">
              <th className="px-3 py-2">{sortBtn("name", "Target")}</th>
              <th className="px-3 py-2">{sortBtn("root", "Root")}</th>
              <th className="px-3 py-2 text-right">{sortBtn("bytes", "Size")}</th>
              <th className="px-3 py-2 text-right">{sortBtn("files", "Files")}</th>
              <th className="px-3 py-2">{sortBtn("assignee", "Assignee")}</th>
              <th className="px-3 py-2">{sortBtn("verdict", "Verdict")}</th>
              <th className="px-3 py-2">{sortBtn("executor", "Executed")}</th>
              <th className="px-3 py-2">{sortBtn("verified_at", "Verified")}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {error && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-red-500">{String(error)}</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                No targets yet — create one with “New target”.
              </td></tr>
            )}
            {rows.map((r: Row) => (
              <tr key={r.id} className="border-b border-border/30 hover:bg-muted/20">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[360px]" title={r.path}>
                    {r.path}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{r.root?.split("/")[1]}</td>
                <td className="px-3 py-2 text-right font-mono">{formatBytes(r.bytes || 0)}</td>
                <td className="px-3 py-2 text-right font-mono">{(r.files || 0).toLocaleString()}</td>
                <td className="px-3 py-2">{r.assignee || <span className="text-muted-foreground/50">—</span>}</td>
                <td className="px-3 py-2">
                  {/* One row, one insert: onChange posts the decision immediately */}
                  <select
                    className={cn(
                      "h-7 px-1.5 rounded border bg-transparent text-xs",
                      r.verdict ? "border-border" : "border-amber-500/50"
                    )}
                    value={r.verdict || ""}
                    disabled={decide.isPending || !currentUser}
                    onChange={e => e.target.value && decide.mutate({ targetId: r.id, verdict: e.target.value })}
                  >
                    <option value="">— undecided —</option>
                    {VERDICTS.map(v => (
                      <option key={v} value={v}
                              disabled={v === "archive" && headroom && !headroom.archive_available}>
                        {v === "archive" && headroom && !headroom.archive_available ? "archive (no headroom)" : v}
                      </option>
                    ))}
                  </select>
                  {r.decided_by && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">by {r.decided_by}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.executor
                    ? <span>{r.executor}</span>
                    : r.verdict && !["keep", "needs_info", "not_mine"].includes(r.verdict)
                      ? <span className="text-amber-600 dark:text-amber-400">pending</span>
                      : <span className="text-muted-foreground/50">—</span>}
                </td>
                <td className="px-3 py-2">
                  {r.verified_at
                    ? <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                    : <span className="text-muted-foreground/50">—</span>}
                </td>
                <td className="px-3 py-2">
                  {r.decision_id && !["keep", "needs_info", "not_mine"].includes(r.verdict || "") && (
                    <button
                      className={cn("text-[11px] hover:underline mr-2",
                        execDrawer === r.id ? "text-primary font-medium" : "text-primary/80")}
                      title="Generate/download executor manifests and upload receipts"
                      onClick={() => setExecDrawer(execDrawer === r.id ? null : r.id)}
                    >
                      {execDrawer === r.id ? "close" : "manifests"}
                    </button>
                  )}
                  {!r.executor && (
                    <DeleteTargetButton targetId={r.id}
                      onDeleted={() => qc.invalidateQueries({ queryKey: ["hk-report"] })} />
                  )}
                </td>
              </tr>
            )).flatMap((row: any, i: number) => {
              const r = rows[i];
              return execDrawer === r.id
                ? [row, (
                    <tr key={`exec-${r.id}`}>
                      <td colSpan={9} className="border-b border-border/40 bg-muted/10 px-4 py-3">
                        <ExecutionDrawer targetId={r.id} decisionId={r.decision_id}
                                         onChanged={() => qc.invalidateQueries({ queryKey: ["hk-report"] })} />
                      </td>
                    </tr>
                  )]
                : [row];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ---------------- Pilot: candidate discovery ----------------

function CandidatesPanel({ root, onAdopted }: { root: string; onAdopted: () => void }) {
  const { currentUser } = useAppStore();
  const [include, setInclude] = useState(".log, .err");
  const [exclude, setExclude] = useState("");
  const [sizeMinMB, setSizeMinMB] = useState("");
  const [sizeMaxMB, setSizeMaxMB] = useState("100");
  const [minAgeDays, setMinAgeDays] = useState("180");
  const [dirSegment, setDirSegment] = useState("");
  const [scan, setScan] = useState<any | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [samplePath, setSamplePath] = useState<string | null>(null);
  const [sample, setSample] = useState<any | null>(null);
  const [campaign, setCampaign] = useState("");
  const presets = useQuery({ queryKey: ["hk-presets"], queryFn: () => api("/candidates/presets") });

  const mb = (v: string): number | null => {
    const t = v.trim();
    if (t === "") return null;
    const n = parseFloat(t);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1024 * 1024) : null;
  };
  const findBody = () => ({
    root,
    include, exclude,
    size_min: mb(sizeMinMB),
    size_max: mb(sizeMaxMB),
    min_age_days: parseInt(minAgeDays) > 0 ? parseInt(minAgeDays) : null,
    dir_segment: dirSegment,
  });

  const applyPreset = (pr: any) => {
    setInclude(pr.include); setExclude(pr.exclude);
    setSizeMinMB(pr.size_min); setSizeMaxMB(pr.size_max_mb);
    setMinAgeDays(pr.min_age_days); setDirSegment(pr.dir_segment);
    setScan(null); setSelected(new Set()); setSamplePath(null);
  };

  const run = async () => {
    setBusy(true);
    setSamplePath(null);
    try {
      const d = await api("/candidates/find", { method: "POST", body: JSON.stringify(findBody()) });
      setScan(d);
      setSelected(new Set());
    } catch (e: any) { toast(e.message, "error"); }
    setBusy(false);
  };

  const toggleSample = async (path: string) => {
    if (samplePath === path) { setSamplePath(null); return; }
    setSamplePath(path);
    setSample(null);
    try {
      const d = await api("/candidates/sample", {
        method: "POST", body: JSON.stringify({ ...findBody(), path }) });
      setSample(d);
    } catch (e: any) { toast(e.message, "error"); setSamplePath(null); }
  };

  const adopt = async () => {
    setBusy(true);
    try {
      const d = await api("/candidates/adopt", {
        method: "POST",
        body: JSON.stringify({ ...findBody(), paths: [...selected],
                               campaign: campaign.trim() || null }),
      }, currentUser);
      const parts = [];
      if (d.created.length) parts.push(`${d.created.length} target(s) created`);
      if (d.existing.length) parts.push(
        `${d.existing.length} already existed (${d.existing.map((e: any) => `#${e.target_id}`).join(", ")}) — pointed at, not duplicated`);
      toast(parts.join("; ") || "nothing to adopt", d.created.length ? "success" : "info");
      setSelected(new Set());
      onAdopted();
    } catch (e: any) { toast(e.message, "error"); }
    setBusy(false);
  };

  const emptyNoExcludes = mb(sizeMaxMB) === 0 && !exclude.trim();

  return (
    <details className="border border-border/60 rounded-md">
      <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none">
        Find files that could be cleaned up
      </summary>
      <div className="p-3 space-y-2 border-t border-border/40 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Presets:</span>
          {(presets.data ?? []).map((pr: any) => (
            <button key={pr.key}
                    className="h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
                    onClick={() => applyPreset(pr)}>
              {pr.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Include names <span title="Comma-separated. .ext = extension; exact name; * = wildcard (e.g. slurm-*.out). Empty = everything.">ⓘ</span></span>
            <input className="h-8 w-56 px-2 rounded border border-border bg-transparent font-mono"
                   placeholder=".log, .err, slurm-*.out"
                   value={include} onChange={e => setInclude(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Exclude names</span>
            <input className="h-8 w-64 px-2 rounded border border-border bg-transparent font-mono"
                   placeholder="__init__.py, .gitkeep, _SUCCESS"
                   value={exclude} onChange={e => setExclude(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Size MB (min–max)</span>
            <span className="flex items-center gap-1">
              <input className="h-8 w-16 px-2 rounded border border-border bg-transparent font-mono"
                     placeholder="min" value={sizeMinMB} onChange={e => setSizeMinMB(e.target.value)} />
              <span className="text-muted-foreground">–</span>
              <input className="h-8 w-16 px-2 rounded border border-border bg-transparent font-mono"
                     placeholder="max" value={sizeMaxMB} onChange={e => setSizeMaxMB(e.target.value)} />
            </span>
          </label>
          <label className="flex flex-col gap-1" title="Only files unmodified for at least this many days (mtime)">
            <span className="text-muted-foreground">Unmodified ≥ days</span>
            <input className="h-8 w-20 px-2 rounded border border-border bg-transparent font-mono"
                   value={minAgeDays} onChange={e => setMinAgeDays(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1" title="Only files inside directories with exactly this name (e.g. __pycache__)">
            <span className="text-muted-foreground">Inside dirs named</span>
            <input className="h-8 w-32 px-2 rounded border border-border bg-transparent font-mono"
                   value={dirSegment} onChange={e => setDirSegment(e.target.value)} />
          </label>
          <button className="h-8 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50"
                  disabled={busy} onClick={run}>{busy ? "Searching…" : "Find"}</button>
          {scan && selected.size > 0 && (
            <>
              <input className="h-8 w-36 px-2 rounded border border-border bg-transparent"
                     placeholder="campaign name"
                     value={campaign} onChange={e => setCampaign(e.target.value)} />
              <button className="h-8 px-3 rounded border border-primary text-primary disabled:opacity-50"
                      disabled={busy || !currentUser} onClick={adopt}>
                Adopt {selected.size} into worklist
              </button>
            </>
          )}
        </div>

        {emptyNoExcludes && (
          <div className="px-2.5 py-1.5 rounded border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            You are including empty files with no exclusions. Zero-byte pipeline sentinels
            look identical to zero-byte garbage — exclude the sentinel names you know
            (the "Empty files" preset fills them in).
          </div>
        )}

        {busy && !scan && <div className="py-6 flex justify-center"><GridLoader label="Searching" /></div>}

        {scan && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-3 py-2 rounded-md border border-border/60 bg-muted/10">
              <span className="text-base font-semibold font-mono">{scan.total_files.toLocaleString()} files</span>
              <span className="text-base font-semibold font-mono">{formatBytes(scan.total_bytes)}</span>
              <span className="text-muted-foreground">
                across {scan.groups_shown} group(s){scan.groups_truncated ? " (list truncated at 200 — totals cover everything)" : ""}
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto border border-border/40 rounded">
              <table className="w-full">
                <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                  <th className="px-2 py-1.5 w-6"></th>
                  <th className="px-2 py-1.5 w-6"></th>
                  <th className="px-2 py-1.5">Path</th>
                  <th className="px-2 py-1.5 text-right">Files</th>
                  <th className="px-2 py-1.5 text-right">Size</th>
                  <th className="px-2 py-1.5">Suggested owner</th>
                </tr></thead>
                <tbody>
                  {scan.groups.map((g: any) => (
                    <>
                      <tr key={g.path} className="border-b border-border/20 hover:bg-muted/20">
                        <td className="px-2 py-1">
                          <input type="checkbox" checked={selected.has(g.path)}
                                 onChange={e => {
                                   const n = new Set(selected);
                                   e.target.checked ? n.add(g.path) : n.delete(g.path);
                                   setSelected(n);
                                 }} />
                        </td>
                        <td className="px-1 py-1">
                          <button className="text-muted-foreground hover:text-foreground"
                                  title="Sample: 20 real paths, subtree and extension breakdown"
                                  onClick={() => toggleSample(g.path)}>
                            {samplePath === g.path ? "▾" : "▸"}
                          </button>
                        </td>
                        <td className="px-2 py-1 font-mono truncate max-w-[360px]" title={g.path}>{g.path}</td>
                        <td className="px-2 py-1 text-right font-mono">{g.files.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right font-mono">{formatBytes(g.bytes)}</td>
                        <td className="px-2 py-1">
                          {g.suggest_assignment
                            ? <span>{g.suggested_owner} <span className="text-muted-foreground">({Math.round(g.owner_confidence * 100)}%)</span></span>
                            : <span className="text-muted-foreground/60">— below 60%, no suggestion</span>}
                        </td>
                      </tr>
                      {samplePath === g.path && (
                        <tr key={g.path + ":s"}>
                          <td colSpan={6} className="border-b border-border/30 bg-muted/10 px-4 py-2">
                            {!sample ? <span className="text-muted-foreground">sampling…</span> : (
                              <div className="grid gap-4 md:grid-cols-3">
                                <div>
                                  <div className="text-muted-foreground mb-1">By subtree — surprises here belong on the protection list:</div>
                                  {sample.subtrees.map((r: any) => (
                                    <div key={r.path} className="flex gap-3 font-mono">
                                      <span className="w-20 text-right">{r.files.toLocaleString()}</span>
                                      <span className="w-16 text-right">{formatBytes(r.bytes)}</span>
                                      <span className="truncate" title={r.path}>{r.path.slice(g.path.length + 1) || "(direct)"}</span>
                                    </div>
                                  ))}
                                </div>
                                <div>
                                  <div className="text-muted-foreground mb-1">By extension:</div>
                                  {sample.extensions.map((r: any) => (
                                    <div key={r.ext} className="flex gap-3 font-mono">
                                      <span className="w-20 text-right">{r.files.toLocaleString()}</span>
                                      <span className="w-16 text-right">{formatBytes(r.bytes)}</span>
                                      <span>.{r.ext}</span>
                                    </div>
                                  ))}
                                </div>
                                <div>
                                  <div className="text-muted-foreground mb-1">20 real paths (largest):</div>
                                  {sample.samples.map((r: any) => (
                                    <div key={r.path} className="font-mono truncate" title={r.path}>
                                      {r.path.slice(g.path.length + 1) || r.path}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {scan.groups.length === 0 && <tr><td colSpan={6} className="px-2 py-3 text-center text-muted-foreground">No matches.</td></tr>}
                </tbody>
              </table>
            </div>
            <ProtectionsLine segments={scan.protected_segments} onChanged={run} />
          </>
        )}
      </div>
    </details>
  );
}

/** The protection list, visible where it acts. Data-driven; edits recorded. */
function ProtectionsLine({ segments, onChanged }: { segments: string[]; onChanged: () => void }) {
  const { currentUser } = useAppStore();
  const [adding, setAdding] = useState(false);
  const [seg, setSeg] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>Never swept (protection list):</span>
      {segments.map(x => <code key={x} className="px-1 rounded bg-muted/30">{x}/</code>)}
      {!adding ? (
        <button className="text-primary hover:underline" onClick={() => setAdding(true)}>+ add</button>
      ) : (
        <span className="inline-flex items-center gap-1">
          <input className="h-6 w-28 px-1.5 rounded border border-border bg-transparent font-mono"
                 placeholder="dirname" value={seg} onChange={e => setSeg(e.target.value)} />
          <input className="h-6 w-48 px-1.5 rounded border border-border bg-transparent"
                 placeholder="why it must never be swept" value={reason}
                 onChange={e => setReason(e.target.value)} />
          <button className="text-primary hover:underline"
                  onClick={async () => {
                    try {
                      await api("/protections", { method: "POST",
                        body: JSON.stringify({ segment: seg, reason }) }, currentUser);
                      setSeg(""); setReason(""); setAdding(false);
                      onChanged();
                    } catch (e: any) { toast(e.message, "error"); }
                  }}>save</button>
          <button className="hover:text-foreground" onClick={() => setAdding(false)}>cancel</button>
        </span>
      )}
    </div>
  );
}

// ---------------- Pilot: worklist upload (return leg of the Drive round trip) ----------------

function UploadPanel({ onApplied }: { onApplied: () => void }) {
  const { currentUser } = useAppStore();
  const [result, setResult] = useState<any | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const push = async (text: string, commit: boolean) => {
    setBusy(true);
    try {
      const d = await api("/worklist-upload", {
        method: "POST", body: JSON.stringify({ csv_text: text, commit }),
      }, currentUser);
      setResult(d);
      if (commit) { setCsvText(null); onApplied(); }
    } catch (e: any) { toast(e.message, "error"); }
    setBusy(false);
  };

  return (
    <div className="inline-flex items-center gap-2">
      <label className="h-8 px-3 text-xs rounded-md border border-border flex items-center gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer">
        ⇪ Upload annotated CSV
        <input type="file" accept=".csv,text/csv" className="hidden"
               onChange={async e => {
                 const f = e.target.files?.[0];
                 if (!f) return;
                 const text = await f.text();
                 setCsvText(text);
                 await push(text, false);
                 e.target.value = "";
               }} />
      </label>
      {result && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setResult(null)}>
          <div className="bg-card border border-border rounded-lg p-4 max-w-2xl w-full max-h-[80vh] overflow-y-auto text-xs space-y-2"
               onClick={e => e.stopPropagation()}>
            <div className="font-medium text-sm">
              {result.committed ? "Applied" : "Review before applying"} — {result.meta?.worklist}
            </div>
            <div className="flex gap-4 font-mono">
              <span className="text-emerald-600">{result.changes.length} changes</span>
              <span>{result.unchanged} unchanged</span>
              <span className={result.warnings.length ? "text-amber-600" : ""}>{result.warnings.length} warnings</span>
              <span className={result.errors.length ? "text-red-600" : ""}>{result.errors.length} errors</span>
            </div>
            {result.errors.map((e: any, i: number) => (
              <div key={i} className="text-red-600">line {e.line}: {e.problem} (row skipped)</div>
            ))}
            {result.warnings.map((w: any, i: number) => (
              <div key={i} className="text-amber-600">line {w.line}: {w.problem}</div>
            ))}
            <table className="w-full">
              <thead><tr className="text-left text-muted-foreground"><th>target</th><th>from</th><th>to</th><th>assignee</th><th>rationale</th></tr></thead>
              <tbody>
                {result.changes.map((c: any) => (
                  <tr key={c.target_id} className="border-t border-border/30">
                    <td className="py-1 font-mono">#{c.target_id}</td>
                    <td className="py-1">{c.from ?? "—"}</td>
                    <td className="py-1 font-medium">{c.to}</td>
                    <td className="py-1">{c.assignee ?? ""}</td>
                    <td className="py-1 text-muted-foreground">{c.rationale ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-2 pt-2">
              {!result.committed && csvText && (
                <button className="h-8 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50"
                        disabled={busy || result.changes.length === 0}
                        onClick={() => push(csvText, true)}>
                  Apply {result.changes.length} change(s)
                </button>
              )}
              <button className="h-8 px-3 rounded border border-border" onClick={() => setResult(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Pilot: quarantine registry + history ----------------

function QuarantinePanel() {
  const { currentUser } = useAppStore();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["hk-quarantine"], queryFn: () => api("/quarantine") });
  const [openManifest, setOpenManifest] = useState<string | null>(null);
  const items = useQuery({
    queryKey: ["hk-quarantine-items", openManifest],
    queryFn: () => api(`/quarantine/items?manifest_id=${encodeURIComponent(openManifest!)}`),
    enabled: !!openManifest,
  });
  const [reconciling, setReconciling] = useState<string | null>(null);
  const [reconNote, setReconNote] = useState("");

  if (isLoading || !data?.length) return null;
  return (
    <details open className="border border-border/60 rounded-md">
      <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none">
        Quarantine <span className="text-muted-foreground">— {data.length} batch(es); status checked against the latest snapshot</span>
      </summary>
      <div className="p-3 border-t border-border/40 space-y-2 text-xs">
        {data.map((g: any) => (
          <div key={g.manifest_id} className="border border-border/40 rounded">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <button className="text-muted-foreground hover:text-foreground"
                      onClick={() => setOpenManifest(openManifest === g.manifest_id ? null : g.manifest_id)}>
                {openManifest === g.manifest_id ? "▾" : "▸"}
              </button>
              <span className="font-mono">{g.manifest_id}</span>
              <span className="font-mono">{g.active.toLocaleString()} held · {formatBytes(g.bytes)}</span>
              {g.restored > 0 && <span className="text-emerald-600 font-mono">{g.restored} restored</span>}
              {g.purged > 0 && <span className="text-muted-foreground font-mono">{g.purged.toLocaleString()} purged</span>}
              <span className="text-muted-foreground">expires {String(g.expires_at).slice(0, 10)}</span>
              <span className={cn("px-1.5 rounded text-[10px]",
                g.status.startsWith("VANISHED") ? "bg-red-500/15 text-red-600 font-medium"
                : g.status.startsWith("partial") ? "bg-amber-500/15 text-amber-600"
                : "bg-muted/30 text-muted-foreground")}>
                {g.status}
              </span>
              {g.active > 0 && (
                reconciling === g.manifest_id ? (
                  <span className="inline-flex items-center gap-1.5">
                    <input className="h-7 w-72 px-2 rounded border border-border bg-transparent"
                           placeholder="How were these removed? (required — goes in the record)"
                           value={reconNote} onChange={e => setReconNote(e.target.value)} autoFocus />
                    <button className="h-7 px-2 rounded bg-red-600 text-white disabled:opacity-50"
                            disabled={!reconNote.trim()}
                            onClick={async () => {
                              try {
                                const d = await api(`/quarantine/${encodeURIComponent(g.manifest_id)}/reconcile`,
                                  { method: "POST", body: JSON.stringify({ note: reconNote }) }, currentUser);
                                toast(`${d.reconciled.toLocaleString()} item(s) marked purged out-of-band.`, "success");
                                setReconciling(null); setReconNote("");
                                qc.invalidateQueries({ queryKey: ["hk-quarantine"] });
                              } catch (e: any) { toast(e.message, "error"); }
                            }}>
                      Mark {g.active.toLocaleString()} purged
                    </button>
                    <button className="h-7 px-2 rounded border border-border"
                            onClick={() => setReconciling(null)}>cancel</button>
                  </span>
                ) : (
                  <button className="text-primary hover:underline text-[11px]"
                          title="For quarantines removed outside the executor — records an out-of-band purge with your note"
                          onClick={() => setReconciling(g.manifest_id)}>
                    reconcile as purged (out-of-band)
                  </button>
                )
              )}
            </div>
            {openManifest === g.manifest_id && (
              <div className="border-t border-border/30 px-3 py-2 max-h-64 overflow-y-auto">
                {items.isLoading ? <span className="text-muted-foreground">loading…</span> : (
                  <table className="w-full">
                    <tbody>
                      {(items.data ?? []).map((q: any) => (
                        <tr key={q.id} className="border-b border-border/20">
                          <td className="px-1 py-1 font-mono truncate max-w-[380px]" title={q.original_path}>{q.original_path}</td>
                          <td className="px-1 py-1 text-right font-mono">{formatBytes(q.size_bytes)}</td>
                          <td className="px-1 py-1">
                            {q.restored_at ? <span className="text-emerald-600">restored</span>
                              : q.purged_at ? <span className="text-muted-foreground">purged</span>
                              : (
                                <span className="inline-flex gap-2">
                                  <button className="text-primary hover:underline"
                                          title={`Copies the exact reverse rename to your clipboard:\nmv '${q.quarantine_path}' '${q.original_path}'`}
                                          onClick={async () => {
                                            await navigator.clipboard.writeText(
                                              `mv '${q.quarantine_path}' '${q.original_path}'`);
                                            toast("Restore command copied — run it on a Midway login node, then click 'mark restored'.", "success");
                                          }}>
                                    copy restore cmd
                                  </button>
                                  <button className="text-primary hover:underline"
                                          title="Record that this file was renamed back to its original path"
                                          onClick={async () => {
                                            try {
                                              await api(`/quarantine/${q.id}/restored`, { method: "POST" }, currentUser);
                                              qc.invalidateQueries({ queryKey: ["hk-quarantine"] });
                                              qc.invalidateQueries({ queryKey: ["hk-quarantine-items"] });
                                            } catch (e: any) { toast(e.message, "error"); }
                                          }}>
                                    mark restored
                                  </button>
                                </span>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function HistoryPanel() {
  const { data } = useQuery({ queryKey: ["hk-events"], queryFn: () => api("/events?limit=100") });
  return (
    <details className="border border-border/60 rounded-md">
      <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none">
        History <span className="text-muted-foreground">— every state change, append-only</span>
      </summary>
      <div className="p-3 border-t border-border/40 max-h-72 overflow-y-auto space-y-1 text-xs font-mono">
        {(data ?? []).map((e: any) => (
          <div key={e.id} className="flex gap-2">
            <span className="text-muted-foreground shrink-0">{String(e.at).slice(0, 19).replace("T", " ")}</span>
            <span className="shrink-0 font-medium">{e.actor}</span>
            <span className="shrink-0">{e.kind}</span>
            {e.target_id && <span className="text-muted-foreground">target #{e.target_id}</span>}
          </div>
        ))}
        {data?.length === 0 && <div className="text-muted-foreground">No events yet.</div>}
      </div>
    </details>
  );
}


// ---------------- "What happened here?" — the record, one search away ----------------

function StoryLookup() {
  const [path, setPath] = useState("");
  const [story, setStory] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    if (!path.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/housekeeping/story?path=${encodeURIComponent(path.trim())}`);
      setStory(await res.json());
    } catch (e: any) { toast(String(e), "error"); }
    setBusy(false);
  };

  return (
    <div className="border border-border/60 rounded-md px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium whitespace-nowrap">What happened here?</span>
        <input
          className="h-8 px-2 rounded border border-border bg-transparent font-mono flex-1 min-w-[280px]"
          placeholder="/project/cil/any/path — works for deleted paths and paths never touched"
          value={path}
          onChange={e => setPath(e.target.value)}
          onKeyDown={e => e.key === "Enter" && lookup()}
        />
        <button className="h-8 px-3 rounded bg-primary text-primary-foreground disabled:opacity-50"
                disabled={busy || !path.trim()} onClick={lookup}>
          {busy ? "…" : "Look up"}
        </button>
        <span className="ml-auto flex items-center gap-2 text-muted-foreground">
          Full record:
          <a className="text-primary hover:underline"
             href={`${API_BASE_URL}/api/housekeeping/archive.json`} download>archive.json</a>
          <a className="text-primary hover:underline"
             href={`${API_BASE_URL}/api/housekeeping/archive.csv`} download>ledger.csv</a>
        </span>
      </div>
      {busy && <div className="py-3 flex justify-center"><GridLoader label="Searching the record" /></div>}
      {story && !busy && (
        <div className="text-xs space-y-1">
          {story.state && !story.verdict && (
            <div className={cn("px-2.5 py-1.5 rounded border",
              story.exists_now ? "border-border/60 bg-muted/20 text-muted-foreground"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
              {story.state}
            </div>
          )}
          {story.verdict ? (
            <div className={cn("px-2.5 py-1.5 rounded border",
              story.existed_previously && !story.exists_now
                ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "border-border/60 bg-muted/20 text-muted-foreground")}>
              {story.verdict}
            </div>
          ) : (
            story.entries.map((e: any, i: number) => (
              <div key={i} className="flex gap-2 items-baseline">
                <span className="font-mono text-muted-foreground shrink-0">{String(e.at).slice(0, 16)}</span>
                <span className="font-medium shrink-0">{e.actor || "system"}</span>
                <span className={cn("shrink-0 px-1.5 rounded text-[10px] uppercase",
                  e.kind === "dismissed" ? "bg-muted/40" :
                  e.kind === "decision" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" :
                  e.kind === "execution" || e.kind === "quarantined" ? "bg-red-500/10 text-red-600" :
                  "bg-primary/10 text-primary")}>{e.kind}</span>
                {e.relation !== "exact" && (
                  <span className="text-[10px] text-muted-foreground shrink-0">({e.relation})</span>
                )}
                <span>{e.summary}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}


// ---------------- The sweep: whole-tree analysis, one action ----------------

function SweepPanel({ root, onSwept }: { root: string; onSwept: () => void }) {
  const { currentUser } = useAppStore();
  const [campaign, setCampaign] = useState("");
  const [minFiles, setMinFiles] = useState("100000");
  const [minTiB, setMinTiB] = useState("5");
  const [minAgeDays, setMinAgeDays] = useState("730");
  const [depth, setDepth] = useState(2);
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const body: any = { root, campaign: campaign.trim(), group_depth: depth };
      if (minFiles.trim()) body.min_files = parseInt(minFiles);
      if (minTiB.trim()) body.min_bytes = Math.round(parseFloat(minTiB) * 1024 ** 4);
      if (minAgeDays.trim()) body.min_age_days = parseInt(minAgeDays);
      const d = await api("/sweep", { method: "POST", body: JSON.stringify(body) }, currentUser);
      setResult(d);
      onSwept();
    } catch (e: any) { toast(e.message, "error"); }
    setBusy(false);
  };

  const csvUrl = (assignee?: string) =>
    `${API_BASE_URL}/api/housekeeping/report.csv?campaign=${encodeURIComponent(campaign.trim())}`
    + (assignee ? `&assignee=${encodeURIComponent(assignee)}` : "");

  return (
    <details className="border border-border/60 rounded-md">
      <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none">
        Sweep <span className="text-muted-foreground">— whole-tree analysis by threshold, one worklist split by owner</span>
      </summary>
      <div className="p-3 space-y-2 border-t border-border/40 text-xs">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">Campaign name
            <input className="h-8 px-2 rounded border border-border bg-transparent w-44"
                   placeholder="e.g. 2026Q3-cleanup"
                   value={campaign} onChange={e => setCampaign(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1" title="Directory groups with at least this many files (leave empty to skip)">
            ≥ files
            <input className="h-8 px-2 rounded border border-border bg-transparent w-28 font-mono"
                   value={minFiles} onChange={e => setMinFiles(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1" title="Directory groups of at least this size (leave empty to skip)">
            ≥ TiB
            <input className="h-8 px-2 rounded border border-border bg-transparent w-20 font-mono"
                   value={minTiB} onChange={e => setMinTiB(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1" title="Groups whose newest file is older than this (mtime — see the age tab caveat)">
            unmodified ≥ days
            <input className="h-8 px-2 rounded border border-border bg-transparent w-24 font-mono"
                   value={minAgeDays} onChange={e => setMinAgeDays(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">Depth
            <select className="h-8 px-2 rounded border border-border bg-transparent"
                    value={depth} onChange={e => setDepth(Number(e.target.value))}>
              {[1, 2, 3].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <button className="h-8 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50"
                  disabled={busy || !campaign.trim() || !currentUser}
                  onClick={run}>
            {busy ? "Sweeping…" : "Run sweep"}
          </button>
          <span className="text-muted-foreground">
            A group matching ANY threshold becomes a target, assigned to its majority
            owner (≥60% confidence; otherwise left unassigned rather than guessed).
            Re-running skips existing targets.
          </span>
        </div>

        {result && (
          <div className="space-y-1 pt-1">
            <div className="font-medium">
              {result.created.length} target(s) created
              {result.skipped_existing > 0 && `, ${result.skipped_existing} already existed`}
              {" — "}worklists per person:
            </div>
            <table className="w-full">
              <tbody>
                {Object.entries(result.by_owner)
                  .sort((a: any, b: any) => b[1].bytes - a[1].bytes)
                  .map(([owner, v]: [string, any]) => (
                    <tr key={owner} className="border-b border-border/20">
                      <td className="py-1 font-mono">{owner}</td>
                      <td className="py-1 text-right font-mono">{v.targets} targets</td>
                      <td className="py-1 text-right font-mono">{formatBytes(v.bytes)}</td>
                      <td className="py-1 text-right font-mono">{v.files.toLocaleString()} files</td>
                      <td className="py-1 pl-3">
                        {!owner.startsWith("(") && (
                          <a className="text-primary hover:underline" href={csvUrl(owner)} download>
                            their CSV
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <a className="text-primary hover:underline" href={csvUrl()} download>
              Download the full campaign CSV (everyone)
            </a>
          </div>
        )}
      </div>
    </details>
  );
}


// ---------------- Execution drawer: manifests + receipts, per target ----------------
// The handoff point between decisions (in here) and the executor (on the
// cluster). Generate -> download -> run on a login node -> upload the
// receipt back; the receipt creates the execution rows.

function ExecutionDrawer({ targetId, decisionId, onChanged }:
  { targetId: number; decisionId: number; onChanged: () => void }) {
  const qc = useQueryClient();
  const [genBusy, setGenBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<any | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  // Upload phases: byte progress during transfer, then row progress while
  // the server processes the job.
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [job, setJob] = useState<any | null>(null);

  const manifests = useQuery({
    queryKey: ["hk-manifests", targetId],
    queryFn: () => api(`/targets/${targetId}/manifests`),
  });

  // Two-step: estimate first — nobody gets a surprise 127 MB file.
  // Small jobs proceed automatically; big ones ask.
  const startGenerate = async () => {
    setGenBusy(true);
    setStatus(null);
    setEstimate(null);
    try {
      const est = await api(`/manifests/${decisionId}/estimate`);
      setEstimate(est);
      if (!est.needs_confirmation) {
        await generate();
        return;
      }
    } catch (e: any) { setStatus(`Failed: ${e.message}`); }
    setGenBusy(false);
  };

  const generate = async () => {
    setGenBusy(true);
    setStatus(null);
    try {
      const d = await api("/manifests", {
        method: "POST", body: JSON.stringify({ decision_id: decisionId }),
      });
      const excluded = d.manifests.find((m: any) => m.manifest_id === null);
      setStatus(`Generated ${d.manifests.filter((m: any) => m.manifest_id).length} manifest(s) from snapshot ${d.snapshot}`
        + (excluded ? ` — ${excluded.note}` : ""));
      qc.invalidateQueries({ queryKey: ["hk-manifests", targetId] });
    } catch (e: any) {
      setStatus(`Failed: ${e.message}`);
    }
    setGenBusy(false);
  };

  const uploadReceipt = async (file: File) => {
    setReceiptBusy(true);
    setStatus(null);
    setJob(null);
    setUploadPct(0);
    try {
      // Compress plain receipts client-side: 109 MB over the tunnel is
      // minutes; ~6 MB gzipped is seconds. Already-.gz files pass through.
      let body: Blob = file;
      if (!file.name.endsWith(".gz") && typeof CompressionStream !== "undefined") {
        const stream = file.stream().pipeThrough(new CompressionStream("gzip"));
        body = await new Response(stream).blob();
      }

      const jobId: number = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE_URL}/api/housekeeping/receipts`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        const uid = currentIdentity();
        if (uid) xhr.setRequestHeader("X-User", uid);
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          try {
            const d = JSON.parse(xhr.responseText);
            if (xhr.status >= 400) reject(new Error(d?.detail || `upload failed (${xhr.status})`));
            else resolve(d.job_id);
          } catch { reject(new Error(`upload failed (${xhr.status})`)); }
        };
        xhr.onerror = () => reject(new Error("network error during upload"));
        xhr.send(body);
      });
      setUploadPct(null);

      // Poll the job until it settles
      for (;;) {
        const st = await api(`/receipts/jobs/${jobId}`);
        setJob(st);
        if (st.status === "done" || st.status === "failed") {
          if (st.status === "done") {
            setStatus(st.note
              ? st.note
              : st.dry_run
                ? "Dry-run receipt recorded (no execution rows — run without dry-run to execute)."
                : `Receipt processed — execution row(s) ${st.execution_ids.join(", ")} created.`);
            onChanged();
            qc.invalidateQueries({ queryKey: ["hk-quarantine"] });
          } else {
            setStatus(`Failed: ${st.error}`);
          }
          break;
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (e: any) {
      setStatus(`Failed: ${e.message}`);
      setUploadPct(null);
    }
    setReceiptBusy(false);
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button className="h-7 px-3 rounded bg-primary text-primary-foreground disabled:opacity-50"
                disabled={genBusy} onClick={startGenerate}>
          {genBusy ? "Working…" : (manifests.data?.length ? "Regenerate manifests" : "Generate manifests")}
        </button>
        <label className="h-7 px-3 rounded border border-border flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
          {receiptBusy ? "Working…" : "⇪ Upload receipt (.json / .json.gz)"}
          <input type="file" accept=".json,.gz,application/json,application/gzip" className="hidden"
                 disabled={receiptBusy}
                 onChange={e => {
                   const f = e.target.files?.[0];
                   if (f) uploadReceipt(f);
                   e.target.value = "";
                 }} />
        </label>
        {uploadPct !== null && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block w-28 h-2 rounded bg-muted/30 overflow-hidden">
              <span className="block h-full bg-primary transition-all" style={{ width: `${uploadPct}%` }} />
            </span>
            uploading {uploadPct}%
          </span>
        )}
        {job && !["done", "failed"].includes(job.status) && uploadPct === null && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block w-28 h-2 rounded bg-muted/30 overflow-hidden">
              <span className="block h-full bg-primary transition-all"
                    style={{ width: `${job.total ? Math.round((job.processed / job.total) * 100) : 5}%` }} />
            </span>
            {job.status === "processing"
              ? `processing ${job.processed.toLocaleString()} of ${job.total.toLocaleString()}`
              : job.status}
          </span>
        )}
        {status && (
          <span className={status.startsWith("Failed") ? "text-red-500" : "text-emerald-600"}>{status}</span>
        )}
      </div>

      {estimate && (
        <div className="px-2.5 py-1.5 rounded border border-border/60 bg-muted/10 space-y-1">
          <div>
            This will resolve <strong className="font-mono">{estimate.files.toLocaleString()}</strong> files
            ({formatBytes(estimate.bytes)}) into <strong>{estimate.manifest_count}</strong> per-owner
            manifest(s), ≈ <strong>{formatBytes(estimate.est_gz_bytes)}</strong> as .json.gz
            ({formatBytes(estimate.est_raw_bytes)} uncompressed).
            {"  "}Extensions: {estimate.extensions.map((e: any) => `.${e.ext} ${e.files.toLocaleString()}`).join(", ")}.
          </div>
          {estimate.needs_confirmation && !genBusy && (
            <button className="h-7 px-3 rounded bg-primary text-primary-foreground"
                    onClick={generate}>
              Confirm — write {estimate.manifest_count} manifest(s)
            </button>
          )}
        </div>
      )}

      {manifests.isLoading ? (
        <span className="text-muted-foreground">loading manifests…</span>
      ) : (manifests.data?.length ?? 0) === 0 ? (
        <span className="text-muted-foreground">
          No manifests yet. Generate resolves this decision's files against the current
          snapshot and writes one manifest per file owner.
        </span>
      ) : (
        <table className="w-auto">
          <tbody>
            {manifests.data!.map((m: any) => (
              <tr key={m.manifest_id} className="border-b border-border/20">
                <td className="py-1 pr-4 font-mono">{m.manifest_id}</td>
                <td className="py-1 pr-4">{m.owner_uname}</td>
                <td className="py-1 pr-4 text-right font-mono">{(m.files ?? 0).toLocaleString()} files</td>
                <td className="py-1 pr-4 text-right font-mono">{formatBytes(m.bytes ?? 0)}</td>
                <td className="py-1 pr-4 text-muted-foreground">{m.generated_at?.slice(0, 10)} (snap {m.snapshot_date})</td>
                <td className="py-1">
                  <a className="text-primary hover:underline"
                     href={`${API_BASE_URL}/api/housekeeping/manifests/${m.manifest_id}`} download>
                    download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="text-[10px] text-muted-foreground">
        On a Midway login node: <code>hk-executor --manifest &lt;file&gt;</code> (dry run) →
        <code>--quarantine</code> (add <code>--delegate</code> when running others' manifests) →
        upload the receipt here. After the 30-day grace: <code>--purge-quarantine</code> deletes
        the held copies (refuses early unless <code>--force</code>) — upload that receipt too and
        the registry marks them purged. Full instructions are embedded in each manifest.
      </div>
    </div>
  );
}


/** Two-step inline delete for mistake targets. The API refuses once
 *  anything was executed — executed history is the record. */
function DeleteTargetButton({ targetId, onDeleted }: { targetId: number; onDeleted: () => void }) {
  const { currentUser } = useAppStore();
  const [arming, setArming] = useState(false);
  return (
    <button
      className={cn("text-[11px] hover:underline",
        arming ? "text-red-600 font-medium" : "text-muted-foreground/60 hover:text-red-500")}
      title="Delete this target (only possible before any execution; the deletion itself is recorded)"
      onClick={async () => {
        if (!arming) { setArming(true); setTimeout(() => setArming(false), 4000); return; }
        try {
          const d = await api(`/targets/${targetId}`, { method: "DELETE" }, currentUser);
          toast(`Target #${targetId} deleted (${d.path}).`, "success");
          onDeleted();
        } catch (e: any) { toast(e.message, "error"); }
        setArming(false);
      }}
    >
      {arming ? "confirm delete" : "delete"}
    </button>
  );
}
