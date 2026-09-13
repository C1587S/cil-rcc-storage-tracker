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

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Plus } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { API_BASE_URL } from "@/lib/api";
import { formatBytes } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";

const ROOTS = ["/cds3/cil", "/project/cil"];
const VERDICTS = ["keep", "delete", "quarantine", "archive", "compress", "needs_info", "not_mine"];

type Row = Record<string, any>;

async function api(path: string, opts: RequestInit = {}, user?: string | null) {
  const res = await fetch(`${API_BASE_URL}/api/housekeeping${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "X-User": user } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail?.detail || `${res.status}`);
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
  const { currentUser } = useAppStore();
  const qc = useQueryClient();
  const [rootFilter, setRootFilter] = useState<string | null>("/cds3/cil");
  const [textFilter, setTextFilter] = useState("");
  const [sortKey, setSortKey] = useState<string>("bytes");
  const [sortDesc, setSortDesc] = useState(true);
  const [showNewTarget, setShowNewTarget] = useState(false);
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
      let destination_path: string | null = null;
      if (verdict === "archive") {
        destination_path = window.prompt("Archive destination path (required):");
        if (!destination_path) return Promise.reject(new Error("archive needs a destination"));
      }
      return api("/decisions", {
        method: "POST",
        body: JSON.stringify({ target_id: targetId, verdict, destination_path }),
      }, currentUser);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["hk-report"] }),
    onError: (e: Error) => window.alert(e.message),
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
    onError: (e: Error) => window.alert(e.message),
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
      { headers: currentUser ? { "X-User": currentUser } : {} },
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

      <CandidatesPanel root={rootFilter || "/project/cil"}
                       onAdopted={() => qc.invalidateQueries({ queryKey: ["hk-report"] })} />

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
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {error && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-red-500">{String(error)}</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ---------------- Pilot: candidate discovery ----------------

function CandidatesPanel({ root, onAdopted }: { root: string; onAdopted: () => void }) {
  const { currentUser } = useAppStore();
  const [category, setCategory] = useState("logs");
  const [groups, setGroups] = useState<any[] | null>(null);
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const d = await api(`/candidates?root=${encodeURIComponent(root)}&category=${category}&group_depth=2`);
      setGroups(d.groups); setLabel(d.label); setSelected(new Set());
    } catch (e: any) { window.alert(e.message); }
    setBusy(false);
  };

  const adopt = async () => {
    setBusy(true);
    try {
      const d = await api("/candidates/adopt", {
        method: "POST",
        body: JSON.stringify({ root, category, paths: [...selected], campaign: "pilot" }),
      }, currentUser);
      window.alert(`${d.created.length} target(s) created` +
        d.created.map((c: any) => `\n  #${c.target_id} ${c.path} -> ${c.assignee ?? "unassigned"}`).join(""));
      setSelected(new Set());
      onAdopted();
    } catch (e: any) { window.alert(e.message); }
    setBusy(false);
  };

  const gb = (b: number) => (b / 1024 ** 3).toFixed(2);
  return (
    <details className="border border-border/60 rounded-md">
      <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none">
        Find candidates <span className="text-muted-foreground">— safe categories, grouped, with suggested owners</span>
      </summary>
      <div className="p-3 space-y-2 border-t border-border/40">
        <div className="flex items-center gap-2 text-xs">
          <select className="h-8 px-2 rounded border border-border bg-transparent"
                  value={category} onChange={e => setCategory(e.target.value)}>
            <option value="logs">.log / .err under 100 MB</option>
            <option value="pycache">__pycache__ contents</option>
          </select>
          <span className="text-muted-foreground font-mono">{root}</span>
          <button className="h-8 px-3 rounded bg-primary text-primary-foreground disabled:opacity-50"
                  disabled={busy} onClick={load}>{busy ? "Scanning…" : "Scan"}</button>
          {groups && selected.size > 0 && (
            <button className="h-8 px-3 rounded border border-primary text-primary disabled:opacity-50"
                    disabled={busy || !currentUser} onClick={adopt}>
              Adopt {selected.size} into worklist
            </button>
          )}
        </div>
        {groups && (
          <div className="max-h-72 overflow-y-auto border border-border/40 rounded">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                <th className="px-2 py-1.5 w-6"></th>
                <th className="px-2 py-1.5">Path</th>
                <th className="px-2 py-1.5 text-right">Size</th>
                <th className="px-2 py-1.5 text-right">Files</th>
                <th className="px-2 py-1.5">Suggested owner</th>
              </tr></thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.path} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="px-2 py-1">
                      <input type="checkbox" checked={selected.has(g.path)}
                             onChange={e => {
                               const n = new Set(selected);
                               e.target.checked ? n.add(g.path) : n.delete(g.path);
                               setSelected(n);
                             }} />
                    </td>
                    <td className="px-2 py-1 font-mono truncate max-w-[380px]" title={g.path}>{g.path}</td>
                    <td className="px-2 py-1 text-right font-mono">{gb(g.bytes)} GB</td>
                    <td className="px-2 py-1 text-right font-mono">{g.files.toLocaleString()}</td>
                    <td className="px-2 py-1">
                      {g.suggest_assignment
                        ? <span>{g.suggested_owner} <span className="text-muted-foreground">({Math.round(g.owner_confidence * 100)}%)</span></span>
                        : <span className="text-muted-foreground/60">— below 60%, no suggestion</span>}
                    </td>
                  </tr>
                ))}
                {groups.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">No matches.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          Empty files are deliberately excluded from every category: zero-byte pipeline
          sentinels look identical to zero-byte garbage.
        </p>
      </div>
    </details>
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
    } catch (e: any) { window.alert(e.message); }
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
  const { data } = useQuery({ queryKey: ["hk-quarantine"], queryFn: () => api("/quarantine") });
  if (!data?.length) return null;
  return (
    <details className="border border-border/60 rounded-md">
      <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none">
        Quarantine <span className="text-muted-foreground">— {data.length} item(s) in grace period</span>
      </summary>
      <div className="p-3 border-t border-border/40 max-h-72 overflow-y-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground border-b border-border/40">
            <th className="px-2 py-1">Original path</th><th className="px-2 py-1">Expires</th><th className="px-2 py-1"></th>
          </tr></thead>
          <tbody>
            {data.map((q: any) => (
              <tr key={q.id} className="border-b border-border/20">
                <td className="px-2 py-1 font-mono truncate max-w-[480px]" title={`now at: ${q.quarantine_path}`}>{q.original_path}</td>
                <td className="px-2 py-1 font-mono">{String(q.expires_at).slice(0, 10)}</td>
                <td className="px-2 py-1">
                  <button className="text-primary hover:underline"
                          title="Record that this file was renamed back to its original path"
                          onClick={async () => {
                            try { await api(`/quarantine/${q.id}/restored`, { method: "POST" }, currentUser); }
                            catch (e: any) { window.alert(e.message); }
                            qc.invalidateQueries({ queryKey: ["hk-quarantine"] });
                          }}>
                    mark restored
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
