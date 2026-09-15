"use client";

/**
 * Housekeeping: two working modes plus the record, switched at the top.
 *
 *  Work   — what you open most days. Three numbers (mine, decided-not-
 *           executed, quarantine), one targets table, the quarantine
 *           section. If you have no pending work it is nearly empty, and
 *           that is correct.
 *  Find   — where new work comes from. Every candidate-producing method
 *           lives there and nowhere else (housekeeping-find.tsx).
 *  Record — the append-only history: per-path story, event log, archive
 *           exports. Fits neither mode above; lives on its own switch.
 *
 * Root comes from the header badge next to the snapshot — the ONE root
 * every panel reads. No panel has its own root control; the Work table
 * spans both roots (work is work, wherever it lives) and shows root as a
 * column.
 *
 * Manual target creation is a dialog behind a button, opened with the
 * global root of the moment — never an expanded form idling with a stale
 * default.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Plus } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { API_BASE_URL } from "@/lib/api";
import { formatBytes } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";
import { FindPanel } from "@/components/housekeeping-find";
import { hkApi as api, toast, currentIdentity } from "@/lib/hk";
import { GridLoader } from "@/components/ui/grid-loader";

const VERDICTS = ["keep", "delete", "quarantine", "archive", "compress", "needs_info", "not_mine"];
const ACTIONABLE = (v: string | null | undefined) =>
  !!v && !["keep", "needs_info", "not_mine"].includes(v);

type Row = Record<string, any>;
type Mode = "work" | "find" | "record";

const loadMode = (): Mode => {
  try {
    const m = localStorage.getItem("hk-mode");
    return m === "find" || m === "record" ? m : "work";
  } catch { return "work"; }
};

export function HousekeepingView() {
  const { referencePath } = useAppStore();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(loadMode);
  // ONE root for everything: the header badge next to the snapshot.
  // referencePath may point at a subdirectory (tree reference feature), so
  // resolve it to its storage root.
  const globalRoot =
    ["/project/cil", "/cds3/cil"].find(r =>
      (referencePath || "/project/cil") === r || (referencePath || "").startsWith(r + "/"))
    ?? "/project/cil";

  const switchMode = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem("hk-mode", m); } catch {}
  };

  const onTargetsCreated = () => qc.invalidateQueries({ queryKey: ["hk-report"] });

  return (
    <div className="space-y-4">
      {/* Mode switch */}
      <div className="flex items-center gap-1">
        {([["work", "Work", "Your pending work: numbers, targets, quarantine"],
           ["find", "Find", "Look for new work — every discovery method"],
           ["record", "Record", "The append-only history: story lookup, events, exports"]] as [Mode, string, string][])
          .map(([m, label, hint]) => (
          <button key={m}
                  className={cn("px-4 h-9 text-sm rounded-md border transition-colors",
                    mode === m
                      ? "border-primary/60 bg-primary/10 text-primary font-semibold"
                      : "border-border/60 text-muted-foreground hover:text-foreground")}
                  title={hint}
                  onClick={() => switchMode(m)}>
            {label}
          </button>
        ))}
      </div>

      {/* Modes unmount when inactive: nothing hidden runs queries. */}
      {mode === "work" && <WorkMode globalRoot={globalRoot} />}
      {mode === "find" && (
        <div className="border border-border/60 rounded-md p-3">
          <FindPanel root={globalRoot} onTargetsCreated={onTargetsCreated} />
        </div>
      )}
      {mode === "record" && <RecordMode />}
    </div>
  );
}


// ================= WORK =================

function WorkMode({ globalRoot }: { globalRoot: string }) {
  const { currentUser } = useAppStore();
  const qc = useQueryClient();
  const [chip, setChip] = useState<"mine" | "all" | "awaiting">("mine");
  const [textFilter, setTextFilter] = useState("");
  const [sortKey, setSortKey] = useState<string>("bytes");
  const [sortDesc, setSortDesc] = useState(true);
  const [execDrawer, setExecDrawer] = useState<number | null>(null);
  const [newTargetOpen, setNewTargetOpen] = useState(false);

  const { data: headroom } = useQuery({
    queryKey: ["hk-headroom"],
    queryFn: () => api("/archive-headroom"),
    staleTime: 5 * 60 * 1000,
  });

  // All roots — work is work, wherever it lives. Root is a column.
  const { data: report, isLoading, error } = useQuery({
    queryKey: ["hk-report"],
    queryFn: () => api("/report"),
  });

  const { data: quarantine } = useQuery({
    queryKey: ["hk-quarantine"],
    queryFn: () => api("/quarantine"),
  });

  const decide = useMutation({
    mutationFn: ({ targetId, verdict }: { targetId: number; verdict: string }) => {
      if (verdict === "archive") {
        return Promise.reject(new Error(
          "Archive needs a destination and is disabled while /cds3/cil has no headroom."));
      }
      return api("/decisions", {
        method: "POST",
        body: JSON.stringify({ target_id: targetId, verdict, destination_path: null }),
      }, currentUser);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["hk-report"] }),
    onError: (e: Error) => toast(e.message, "error"),
  });

  const allRows: Row[] = report?.rows ?? [];

  // ----- the three numbers -----
  const me = currentUser?.toLowerCase();
  const mine = allRows.filter(r => me && r.assignee === me && !r.executor);
  const awaiting = allRows.filter(r => ACTIONABLE(r.verdict) && !r.executor);
  const qActive = (quarantine ?? []).filter((g: any) => g.active > 0);
  const qFiles = qActive.reduce((s: number, g: any) => s + g.active, 0);
  const qBytes = qActive.reduce((s: number, g: any) => s + g.bytes, 0);
  const qNextExpiry = qActive.length
    ? qActive.map((g: any) => String(g.expires_at).slice(0, 10)).sort()[0]
    : null;

  const sum = (rows: Row[]) => rows.reduce((s, r) => s + (r.bytes || 0), 0);

  // ----- table rows under the active chip -----
  const rows: Row[] = useMemo(() => {
    let r = chip === "mine" ? mine : chip === "awaiting" ? awaiting : allRows;
    const t = textFilter.trim().toLowerCase();
    if (t) {
      r = r.filter((x: Row) =>
        [x.name, x.path, x.assignee, x.verdict, x.created_by, x.campaign]
          .some(v => v && String(v).toLowerCase().includes(t)));
    }
    return [...r].sort((a, b) => {
      const av = a[sortKey] ?? "", bv = b[sortKey] ?? "";
      const cmp = typeof av === "number" || typeof bv === "number"
        ? (Number(av) || 0) - (Number(bv) || 0)
        : String(av).localeCompare(String(bv));
      return sortDesc ? -cmp : cmp;
    });
  }, [allRows, chip, me, textFilter, sortKey, sortDesc]);

  const downloadCsv = async () => {
    const res = await fetch(`${API_BASE_URL}/api/housekeeping/report.csv`, {
      headers: (currentUser ?? currentIdentity()) ? { "X-User": (currentUser ?? currentIdentity())! } : {},
    });
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

  const emptyMessage =
    chip === "mine"
      ? (me ? "Nothing assigned to you and unexecuted. An empty queue is a finished queue."
            : "Sign in to see your assignments.")
      : chip === "awaiting"
        ? "Nothing decided is waiting on execution."
        : "No targets yet — find some under Find, or create one manually.";

  return (
    <div className="space-y-4">
      {/* Persistent headroom banner — it gates the archive verdict below */}
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

      {/* The three numbers */}
      <div className="flex flex-wrap gap-3">
        <button className={cn("px-4 py-2.5 rounded-md border text-left transition-colors",
                  chip === "mine" ? "border-primary/60 bg-primary/10" : "border-border/60 bg-card hover:border-primary/40")}
                title="Targets assigned to you, not yet executed — click to filter the table"
                onClick={() => setChip("mine")}>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Assigned to me</div>
          <div className="text-lg font-semibold font-mono">
            {me ? mine.length : "—"}
            <span className="text-xs font-normal text-muted-foreground"> · {formatBytes(sum(mine))}</span>
          </div>
        </button>
        <button className={cn("px-4 py-2.5 rounded-md border text-left transition-colors",
                  chip === "awaiting" ? "border-amber-500/60 bg-amber-500/10" : "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60")}
                title="Decided but not executed — the gap someone chases weekly. Click to filter."
                onClick={() => setChip("awaiting")}>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Decided, not executed</div>
          <div className="text-lg font-semibold font-mono text-amber-600 dark:text-amber-400">
            {awaiting.length}
            <span className="text-xs font-normal text-muted-foreground"> · {formatBytes(sum(awaiting))}</span>
          </div>
        </button>
        <div className="px-4 py-2.5 rounded-md border border-border/60 bg-card"
             title="Held copies still restorable; details in the quarantine section below">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">In quarantine</div>
          <div className="text-lg font-semibold font-mono">
            {qFiles.toLocaleString()}
            <span className="text-xs font-normal text-muted-foreground">
              {" "}· {formatBytes(qBytes)}{qNextExpiry ? ` · first expiry ${qNextExpiry}` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border overflow-hidden text-xs">
          {([["mine", "mine"], ["all", "all"], ["awaiting", "awaiting execution"]] as const).map(([c, label]) => (
            <button
              key={c}
              className={cn("px-3 h-8 transition-colors",
                chip === c ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}
              onClick={() => setChip(c)}
            >
              {label}
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
          title="Manual target creation — the rare case; most targets come from Find"
          onClick={() => setNewTargetOpen(true)}
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

      {newTargetOpen && (
        <NewTargetDialog globalRoot={globalRoot}
                         onClose={() => setNewTargetOpen(false)}
                         onCreated={() => {
                           setNewTargetOpen(false);
                           qc.invalidateQueries({ queryKey: ["hk-report"] });
                         }} />
      )}

      {/* The targets table */}
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
            {!isLoading && !error && rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                {emptyMessage}
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
                    : ACTIONABLE(r.verdict)
                      ? <span className="text-amber-600 dark:text-amber-400">pending</span>
                      : <span className="text-muted-foreground/50">—</span>}
                </td>
                <td className="px-3 py-2">
                  {r.verified_at
                    ? <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                    : <span className="text-muted-foreground/50">—</span>}
                </td>
                <td className="px-3 py-2">
                  {r.decision_id && ACTIONABLE(r.verdict) && (
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

      <QuarantineSection />
    </div>
  );
}


/** Manual target creation: a dialog, not a resident form. Root is the
 *  global root of the moment it opens — switch roots in the header. */
function NewTargetDialog({ globalRoot, onClose, onCreated }:
  { globalRoot: string; onClose: () => void; onCreated: () => void }) {
  const { currentUser } = useAppStore();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [scope, setScope] = useState("subtree");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await api("/targets", {
        method: "POST",
        body: JSON.stringify({
          name, path, scope,
          root: globalRoot,
          campaign: globalRoot === "/cds3/cil" ? "cds3-clear" : null,
        }),
      }, currentUser);
      toast(`Target "${name}" created.`, "success");
      onCreated();
    } catch (e: any) { toast(e.message, "error"); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-card border border-border rounded-lg p-4 w-full max-w-xl text-xs space-y-3"
           onClick={e => e.stopPropagation()}>
        <div className="font-medium text-sm">New target</div>
        <div className="text-muted-foreground">
          Under <code className="font-mono">{globalRoot}</code> — to target the other root,
          switch it in the header first. Most targets should come from Find; this is for the
          case where you already know the exact path.
        </div>
        <label className="flex flex-col gap-1">Name
          <input className="h-8 px-2 rounded border border-border bg-transparent"
                 autoFocus value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">Path (under {globalRoot})
          <input className="h-8 px-2 rounded border border-border bg-transparent font-mono"
                 placeholder={`${globalRoot}/...`}
                 value={path} onChange={e => setPath(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">Scope
          <select className="h-8 px-2 rounded border border-border bg-transparent w-40"
                  value={scope} onChange={e => setScope(e.target.value)}>
            <option value="subtree">subtree</option>
            <option value="shallow">shallow</option>
            <option value="single_file">single file</option>
          </select>
        </label>
        <div className="flex gap-2 pt-1">
          <button className="h-8 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50"
                  disabled={!name || !path || busy || !currentUser}
                  onClick={create}>
            {busy ? "Resolving…" : "Create"}
          </button>
          <button className="h-8 px-3 rounded border border-border" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}


// ---------------- worklist upload (return leg of the Drive round trip) ----------------

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

// ---------------- quarantine registry ----------------

function QuarantineSection() {
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
    <div className="border border-border/60 rounded-md">
      <div className="px-3 py-2 text-xs font-medium border-b border-border/40">
        Quarantine <span className="text-muted-foreground">— {data.length} batch(es); status checked against the latest snapshot</span>
      </div>
      <div className="p-3 space-y-2 text-xs">
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
    </div>
  );
}


// ================= RECORD =================
// The append-only history. Fits neither Work nor Find — it is not pending
// work and produces no candidates — so it lives on its own switch.

function RecordMode() {
  return (
    <div className="space-y-4">
      <StoryLookup />
      <HistoryPanel />
    </div>
  );
}

function HistoryPanel() {
  const { data } = useQuery({ queryKey: ["hk-events"], queryFn: () => api("/events?limit=100") });
  return (
    <div className="border border-border/60 rounded-md">
      <div className="px-3 py-2 text-xs font-medium border-b border-border/40">
        History <span className="text-muted-foreground">— every state change, append-only (latest 100)</span>
      </div>
      <div className="p-3 max-h-96 overflow-y-auto space-y-1 text-xs font-mono">
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
    </div>
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


// ---------------- Execution drawer: manifests + receipts, per target ----------------
// The handoff point between decisions (in here) and the executor (on the
// cluster). Generate -> copy command or download -> run on a login node ->
// the receipt creates the execution rows.

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
                <td className="py-1 pr-4">
                  <CopyRunCommand manifestId={m.manifest_id} />
                </td>
                <td className="py-1">
                  <a className="text-primary hover:underline"
                     href={`${API_BASE_URL}/api/housekeeping/manifests/${m.manifest_id}`} download
                     title="Offline path: download the manifest file and run hk-executor --manifest <file>">
                    download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="text-[10px] text-muted-foreground">
        <strong>copy command</strong> gives the whole round trip in one paste: the executor
        fetches the manifest over HTTPS, and after the run uploads the receipt by itself
        (<code>--no-upload</code> keeps it local). Dry run by default — add
        <code>--quarantine</code> (plus <code>--delegate</code> for others' files) to act.
        After the 30-day grace: <code>--purge-quarantine</code> deletes the held copies
        (refuses early unless <code>--force</code>). Offline fallback: <strong>download</strong> the
        file and run <code>hk-executor --manifest &lt;file&gt;</code>, then upload the receipt here.
      </div>
    </div>
  );
}


/** One-paste handoff to the cluster: fetches the complete run command
 *  (token rides an env var, not argv — argv is world-readable in `ps` on
 *  shared login nodes) and puts it on the clipboard. */
function CopyRunCommand({ manifestId }: { manifestId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={cn("text-[11px] hover:underline whitespace-nowrap",
        copied ? "text-emerald-600 font-medium" : "text-primary")}
      title="Copy the complete hk-executor command: fetches this manifest over HTTPS and uploads the receipt automatically when done"
      onClick={async () => {
        try {
          const d = await api(`/manifests/${manifestId}/command`);
          await navigator.clipboard.writeText(d.command);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (e: any) { toast(e.message, "error"); }
      }}
    >
      {copied ? "copied!" : "copy command"}
    </button>
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
