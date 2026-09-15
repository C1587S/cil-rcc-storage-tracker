"use client";

/**
 * Find mode: where new work comes from. One method selector, one result
 * table, one action.
 *
 * Every method (age, browse, owners, largest files, duplicates, patterns)
 * feeds the SAME result table — path, size, files, likely owner, checkbox —
 * and the same selection bar with one primary action: "Create N targets".
 * Saving a selection for later (custom lists) is a secondary action on that
 * bar, not a concept of its own; "Saved" is just a method that loads a
 * previous selection back into the table.
 *
 * Two deliberate deviations, kept visible rather than papered over:
 *  - Duplicates keeps its grouped table: a flat row per copy would lose the
 *    grouping that makes it readable, and checkboxes live only on individual
 *    copies inside a group — selecting "the whole group" would mean deleting
 *    every copy of a file, which is never what anyone wants.
 *  - Sweep still creates targets directly: the API does analysis and
 *    creation in one call, so it cannot preview into the table without a
 *    backend change. Its button says so.
 *
 * Root comes from the header (the single global root). No method has its
 * own root control.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { API_BASE_URL } from "@/lib/api";
import { hkApi as api, reconApi as rapi, activeList, setActiveList, toast } from "@/lib/hk";
import { GridLoader } from "@/components/ui/grid-loader";
import { formatBytes } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";

type Method = "age" | "browse" | "owners" | "largest" | "dups" | "patterns" | "sweep" | "saved";

const METHODS: [Method, string, string][] = [
  ["age", "Age", "Coldest maximal subtrees — nothing inside modified for years"],
  ["browse", "Browse", "Directories ranked by file-count pressure; click a path to list its files"],
  ["owners", "Owners", "Who holds what; click an owner for their biggest directories"],
  ["largest", "Largest files", "Biggest single files under the root"],
  ["dups", "Duplicates", "Same basename + same size above a threshold"],
  ["patterns", "Patterns & size", "Find files by name patterns, size range and age"],
  ["sweep", "Sweep", "Whole-tree thresholds — creates a per-owner worklist directly"],
  ["saved", "Saved", "Selections saved for later from the bar below"],
];

/** Unified result row. `kind` decides the scope of a created target. */
type FindRow = {
  path: string;
  bytes: number;
  files: number;
  kind: "dir" | "file";
  owner?: string | null;
  ownerConf?: number | null;
  lastModified?: number;
  dismissed?: any;
};

const fmtAge = (epoch?: number) => {
  if (!epoch) return "—";
  const days = (Date.now() / 1000 - epoch) / 86400;
  if (days >= 365) return `${(days / 365).toFixed(1)} y`;
  if (days >= 30) return `${Math.round(days / 30)} mo`;
  return `${Math.max(0, Math.round(days))} d`;
};
const fmtDate = (epoch?: number) => (epoch ? new Date(epoch * 1000).toISOString().slice(0, 10) : "—");

/** files per GB — the disagreement channel between inodes and bytes */
const density = (files: number, bytes: number) =>
  bytes > 0 ? files / (bytes / 1024 ** 3) : files > 0 ? Infinity : 0;
const fmtDensity = (files: number, bytes: number) => {
  const d = density(files, bytes);
  if (!isFinite(d)) return "∞";
  if (d >= 1000) return `${(d / 1000).toFixed(1)}K/GB`;
  return `${d.toFixed(d < 10 ? 1 : 0)}/GB`;
};

function Loading({ label }: { label: string }) {
  return <div className="py-8 flex justify-center"><GridLoader label={label} /></div>;
}

export function FindPanel({ root, onTargetsCreated }: { root: string; onTargetsCreated: () => void }) {
  const { currentUser } = useAppStore();
  const qc = useQueryClient();
  const [method, setMethod] = useState<Method>("age");
  // Selection is a Map so each path remembers its row (kind decides the
  // created target's scope: subtree for dirs, single_file for files).
  const [selected, setSelected] = useState<Map<string, FindRow>>(new Map());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  // Browse drill state: a path listing inside the same table shape.
  const [drill, setDrill] = useState<{ prefix: string; owner?: string } | null>(null);
  const [ownerDrill, setOwnerDrill] = useState<string | null>(null);
  const [selSource, setSelSource] = useState("find");

  // ----- method queries (only the active method runs one) -----
  const [minAgeDays, setMinAgeDays] = useState(365);
  const age = useQuery({
    queryKey: ["recon-age", root, minAgeDays, showDismissed],
    queryFn: () => rapi(`/age?root=${encodeURIComponent(root)}&min_age_days=${minAgeDays}&include_dismissed=${showDismissed}`),
    enabled: method === "age",
  });
  const dirs = useQuery({
    queryKey: ["recon-dirs", root, showDismissed],
    queryFn: () => rapi(`/dirs?root=${encodeURIComponent(root)}&include_dismissed=${showDismissed}`),
    enabled: method === "browse" && !drill,
  });
  const files = useQuery({
    queryKey: ["recon-files", root, drill?.prefix, drill?.owner],
    queryFn: () => rapi(
      `/files?root=${encodeURIComponent(root)}&prefix=${encodeURIComponent(drill!.prefix)}`
      + (drill?.owner ? `&owner=${encodeURIComponent(drill.owner)}` : "")),
    enabled: method === "browse" && !!drill,
  });
  const owners = useQuery({
    queryKey: ["recon-owners", root],
    queryFn: () => rapi(`/owners?root=${encodeURIComponent(root)}`),
    enabled: method === "owners",
  });
  const ownerDirs = useQuery({
    queryKey: ["recon-odirs", root, ownerDrill],
    queryFn: () => rapi(`/owner-dirs?root=${encodeURIComponent(root)}&owner=${encodeURIComponent(ownerDrill!)}`),
    enabled: method === "owners" && !!ownerDrill,
  });
  const largest = useQuery({
    queryKey: ["recon-largest", root],
    queryFn: () => rapi(`/largest?root=${encodeURIComponent(root)}`),
    enabled: method === "largest",
  });

  const invalidateRecon = () =>
    ["recon-age", "recon-dirs", "recon-preview"].forEach(k => qc.invalidateQueries({ queryKey: [k] }));

  // ----- selection -----
  const toggle = (row: FindRow, source: string) => {
    setSelSource(source);
    setSelected(prev => {
      const n = new Map(prev);
      n.has(row.path) ? n.delete(row.path) : n.set(row.path, row);
      return n;
    });
  };
  const Check = ({ row, source }: { row: FindRow; source: string }) => (
    <input type="checkbox" checked={selected.has(row.path)} onChange={() => toggle(row, source)} />
  );

  const drillTo = (prefix: string, owner?: string) => {
    setMethod("browse");
    setDrill({ prefix, owner });
    setExpanded(null);
  };

  const undismiss = async (id: number) => {
    try {
      await rapi(`/dismissals/${id}`, { method: "DELETE" }, currentUser);
      invalidateRecon();
    } catch (e: any) { toast(e.message, "error"); }
  };

  // ----- unified result table -----
  const [sortKey, setSortKey] = useState("bytes");
  const [sortDesc, setSortDesc] = useState(true);
  const sortRows = (rows: FindRow[]) =>
    [...rows].sort((a, b) => {
      const get = (x: FindRow) => sortKey === "__density"
        ? density(x.files, x.bytes)
        : (x as any)[sortKey] ?? 0;
      const av = get(a), bv = get(b);
      const c = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDesc ? -c : c;
    });
  const TH = ({ k, label, right, title }: { k: string; label: string; right?: boolean; title?: string }) => (
    <th className={cn("px-2 py-1.5 whitespace-nowrap", right && "text-right")} title={title}>
      <button className="hover:text-foreground"
              onClick={() => (sortKey === k ? setSortDesc(!sortDesc) : (setSortKey(k), setSortDesc(true)))}>
        {label}{sortKey === k ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  /** THE table. Same columns for every method; cells a method cannot fill
   *  show an em-dash. `expandable` adds the preview/dismiss drawer. */
  function ResultTable({ rows, source, expandable, pathBase }:
    { rows: FindRow[]; source: string; expandable?: boolean; pathBase?: string }) {
    const base = pathBase ?? root;
    const sorted = sortRows(rows);
    return (
      <table className="w-full text-xs">
        <thead><tr className="text-left text-muted-foreground border-b border-border/40">
          <th className="w-6"></th>
          {expandable && <th className="w-6"></th>}
          <th className="px-2 py-1.5">Path</th>
          {TH({ k: "bytes", label: "Size", right: true })}
          {TH({ k: "files", label: "Files", right: true })}
          {TH({ k: "__density", label: "Files/GB", right: true, title: "High density = inode problem, not byte problem" })}
          {TH({ k: "owner", label: "Likely owner" })}
          {TH({ k: "lastModified", label: "Last modified", right: true })}
        </tr></thead>
        <tbody>
          {sorted.map(r => (
            <>
              <tr key={r.path} className={cn("border-b border-border/20 hover:bg-muted/20", r.dismissed && "opacity-50")}>
                <td className="px-1 py-1"><Check row={r} source={source} /></td>
                {expandable && (
                  <td className="px-1 py-1">
                    <button className="text-muted-foreground hover:text-foreground"
                            title="Preview: samples, extensions, owners, dates — and dismiss"
                            onClick={() => setExpanded(expanded === r.path ? null : r.path)}>
                      {expanded === r.path ? "▾" : "▸"}
                    </button>
                  </td>
                )}
                <td className="px-2 py-1">
                  {r.kind === "dir" ? (
                    <button className="font-mono text-left hover:underline truncate max-w-[420px] block"
                            title={`${r.path} — click to list its files`}
                            onClick={() => drillTo(r.path, r.owner ?? undefined)}>
                      {r.path.slice(base.length) || "/"}
                    </button>
                  ) : (
                    <span className="font-mono truncate max-w-[420px] block" title={r.path}>
                      {r.path.slice(base.length) || r.path}
                    </span>
                  )}
                  {r.dismissed && (
                    <div className="text-[10px] text-muted-foreground italic">
                      dismissed by {r.dismissed.by}: {r.dismissed.note}{" "}
                      <button className="text-primary not-italic hover:underline"
                              onClick={() => undismiss(r.dismissed.id)}>un-dismiss</button>
                    </div>
                  )}
                </td>
                <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                <td className="px-2 py-1 text-right font-mono">{r.files.toLocaleString()}</td>
                <td className={cn("px-2 py-1 text-right font-mono",
                  density(r.files, r.bytes) >= 1000 && "text-amber-600 dark:text-amber-400 font-semibold")}>
                  {fmtDensity(r.files, r.bytes)}
                </td>
                <td className="px-2 py-1 font-mono">
                  {r.owner
                    ? <span>{r.owner}{r.ownerConf != null && <span className="text-muted-foreground"> ({Math.round(r.ownerConf * 100)}%)</span>}</span>
                    : <span className="text-muted-foreground/50">—</span>}
                </td>
                <td className="px-2 py-1 text-right font-mono" title={fmtDate(r.lastModified)}>
                  {r.lastModified ? `${fmtAge(r.lastModified)} ago` : "—"}
                </td>
              </tr>
              {expandable && expanded === r.path && (
                <tr key={r.path + ":pv"}>
                  <td colSpan={8} className="border-b border-border/30">
                    <PreviewBox path={r.path} root={root} onChanged={invalidateRecon} currentUser={currentUser} />
                  </td>
                </tr>
              )}
            </>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={8} className="px-2 py-4 text-center text-muted-foreground">No matches.</td></tr>
          )}
        </tbody>
      </table>
    );
  }

  const dismissedToggle = (data: any) => (
    <>
      {(data?.hidden_dismissed ?? 0) > 0 && !showDismissed && (
        <button className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowDismissed(true)}>
          {data.hidden_dismissed} dismissed hidden — show
        </button>
      )}
      {showDismissed && (
        <button className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowDismissed(false)}>hide dismissed</button>
      )}
    </>
  );

  const asDir = (r: any): FindRow => ({
    path: r.path, bytes: r.bytes ?? 0, files: r.files ?? 0, kind: "dir",
    owner: r.owner, lastModified: r.last_modified, dismissed: r.dismissed,
  });
  const asFile = (r: any): FindRow => ({
    path: r.path, bytes: r.bytes ?? 0, files: 1, kind: "file",
    owner: r.owner, lastModified: r.last_modified,
  });

  return (
    <div className="space-y-3">
      {/* ---- method selector ---- */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border/40 pb-1">
        {METHODS.map(([m, label, hint]) => (
          <button key={m}
                  className={cn("px-2.5 h-7 text-xs rounded-t border-b-2 transition-colors",
                    method === m ? "border-primary text-primary font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground")}
                  title={hint}
                  onClick={() => { setMethod(m); setExpanded(null); if (m !== "browse") setDrill(null); }}>
            {label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground font-mono" title="Change the root in the header, next to the snapshot">{root}</span>
      </div>

      {/* ---- AGE ---- */}
      {method === "age" && (
        <>
          <div className="text-[11px] px-2.5 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            Measures time since last <strong>modification</strong> (mtime) anywhere in the subtree.
            Reading a file does not update mtime, and atime is unreliable on this mount —
            "not modified" is <strong>not</strong> "unused". A reference dataset can be read weekly
            and written never.
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Older than</span>
            {[180, 365, 730, 1095].map(d => (
              <button key={d}
                      className={cn("px-2 h-7 rounded border",
                        minAgeDays === d ? "border-primary text-primary" : "border-border text-muted-foreground")}
                      disabled={age.isFetching}
                      onClick={() => setMinAgeDays(d)}>
                {d >= 365 ? `${d / 365} y` : `${d} d`}
              </button>
            ))}
            {dismissedToggle(age.data)}
          </div>
          {age.isLoading ? <Loading label="Finding cold trees" /> : (
            <ResultTable rows={(age.data?.rows ?? []).map(asDir)} source={`find:age>${minAgeDays}d`} expandable />
          )}
        </>
      )}

      {/* ---- BROWSE (directories, drill to files) ---- */}
      {method === "browse" && !drill && (
        <>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Directories by file count — click a path to list its files.</span>
            {dismissedToggle(dirs.data)}
          </div>
          {dirs.isLoading ? <Loading label="Ranking by file count" /> : (
            <ResultTable rows={(dirs.data?.rows ?? []).map(asDir)} source="find:browse" expandable />
          )}
        </>
      )}
      {method === "browse" && drill && (
        <>
          <div className="flex items-center gap-2 text-xs">
            <button className="text-primary hover:underline" onClick={() => setDrill(null)}>◂ directories</button>
            <span className="text-muted-foreground font-mono">{drill.prefix}{drill.owner ? ` — owner ${drill.owner}` : ""}</span>
          </div>
          {files.isLoading ? <Loading label={`Listing ${drill.prefix}`} /> : (
            <ResultTable rows={(files.data?.rows ?? []).map(asFile)} source="find:files" pathBase={drill.prefix} />
          )}
        </>
      )}

      {/* ---- OWNERS ---- */}
      {method === "owners" && (
        owners.isLoading ? <Loading label="Aggregating by owner" /> : (
          <div className="grid gap-3 md:grid-cols-2">
            <table className="w-full text-xs self-start">
              <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                <th className="px-2 py-1.5">Owner</th>
                <th className="px-2 py-1.5 text-right">Bytes</th>
                <th className="px-2 py-1.5 text-right">Files</th>
                <th className="px-2 py-1.5 text-right">Files/GB</th>
              </tr></thead>
              <tbody>
                {(owners.data?.rows ?? []).map((r: any) => (
                  <tr key={r.owner}
                      className={cn("border-b border-border/20 hover:bg-muted/20 cursor-pointer",
                        ownerDrill === r.owner && "bg-primary/10")}
                      onClick={() => setOwnerDrill(r.owner)}>
                    <td className="px-2 py-1 font-mono">{r.owner}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                    <td className="px-2 py-1 text-right font-mono">{r.files.toLocaleString()}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmtDensity(r.files, r.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              {ownerDrill ? (
                ownerDirs.isLoading ? <Loading label={`Scanning ${ownerDrill}'s directories`} /> : (
                  <>
                    <div className="text-xs font-medium mb-1">{ownerDrill} — biggest directories</div>
                    <ResultTable
                      rows={(ownerDirs.data?.rows ?? []).map((r: any) => ({ ...asDir(r), owner: ownerDrill }))}
                      source={`find:owner:${ownerDrill}`} />
                  </>
                )
              ) : (
                <div className="text-xs text-muted-foreground pt-6 text-center">
                  Click an owner to see their biggest directories.
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* ---- LARGEST FILES ---- */}
      {method === "largest" && (
        largest.isLoading ? <Loading label="Finding the largest files" /> : (
          <ResultTable rows={(largest.data?.rows ?? []).map(asFile)} source="find:largest" />
        )
      )}

      {/* ---- DUPLICATES (grouped — see header comment) ---- */}
      {method === "dups" && (
        <DuplicatesMethod root={root} selected={selected} toggle={toggle} />
      )}

      {/* ---- PATTERNS & SIZE ---- */}
      {method === "patterns" && (
        <PatternsMethod root={root} selected={selected} toggle={toggle} Check={Check}
                        clear={() => setSelected(new Map())}
                        onTargetsCreated={onTargetsCreated}
                        onProtectionsChanged={invalidateRecon} />
      )}

      {/* ---- SWEEP (creates directly — see header comment) ---- */}
      {method === "sweep" && <SweepMethod root={root} onSwept={onTargetsCreated} />}

      {/* ---- SAVED SELECTIONS ---- */}
      {method === "saved" && <SavedMethod onTargetsCreated={onTargetsCreated} />}

      {/* ---- THE selection bar: one action, one secondary ----
          Patterns renders its own identically-shaped bar because its
          creation must carry the search predicate (see PatternsMethod). */}
      {selected.size > 0 && !["sweep", "saved", "patterns"].includes(method) && (
        <SelectionBar root={root} selected={selected} source={selSource}
                      clear={() => setSelected(new Map())}
                      onTargetsCreated={onTargetsCreated} />
      )}
    </div>
  );
}


/** The one selection bar. Primary: create targets. Secondary: save for later. */
function SelectionBar({ root, selected, source, clear, onTargetsCreated }: {
  root: string; selected: Map<string, FindRow>; source: string;
  clear: () => void; onTargetsCreated: () => void;
}) {
  const { currentUser } = useAppStore();
  const qc = useQueryClient();
  const [campaign, setCampaign] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [note, setNote] = useState("");
  const [active, setActive] = useState(activeList());
  const lists = useQuery({ queryKey: ["hk-lists"], queryFn: () => rapi("/lists") });

  const createTargets = async () => {
    setBusy(true);
    let created = 0, failed = 0, firstError = "";
    for (const row of selected.values()) {
      try {
        await api("/targets", {
          method: "POST",
          body: JSON.stringify({
            name: `${source.replace(/^find:/, "")}: ${row.path.split("/").pop() || row.path}`,
            root,
            path: row.path,
            scope: row.kind === "file" ? "single_file" : "subtree",
            campaign: campaign.trim() || null,
          }),
        }, currentUser);
        created++;
      } catch (e: any) {
        failed++;
        if (!firstError) firstError = e.message;
      }
    }
    toast(
      `${created} target(s) created${campaign.trim() ? ` under campaign "${campaign.trim()}"` : ""}`
      + (failed ? ` — ${failed} failed (${firstError})` : ""),
      failed ? "error" : "success");
    if (created) { clear(); onTargetsCreated(); }
    setBusy(false);
  };

  const saveForLater = async () => {
    setSaving(true);
    try {
      let list = active;
      if (!list) {
        const name = newListName.trim();
        if (!name) { toast("Name the new list first.", "error"); setSaving(false); return; }
        const d = await rapi("/lists", { method: "POST", body: JSON.stringify({ name, root }) }, currentUser);
        list = { id: d.id, name };
        setActive(list); setActiveList(list); setNewListName("");
      }
      const d = await rapi(`/lists/${list.id}/items`, {
        method: "POST",
        body: JSON.stringify({
          paths: [...selected.keys()],
          source: note.trim() ? `${source} — ${note.trim()}` : source,
        }),
      }, currentUser);
      const rej = d.rejected?.length ? ` · ${d.rejected.length} rejected (${d.rejected[0].reason})` : "";
      toast(`Saved ${d.added.length} to "${list.name}"${rej} — find them under Saved.`, "success");
      clear(); setNote(""); setSaveOpen(false);
      qc.invalidateQueries({ queryKey: ["hk-lists"] });
      qc.invalidateQueries({ queryKey: ["hk-list-items"] });
    } catch (e: any) { toast(e.message, "error"); }
    setSaving(false);
  };

  return (
    <div className="sticky bottom-0 px-3 py-2 border-t-2 border-primary/40 bg-card rounded-b-md flex flex-wrap items-center gap-2 text-xs shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
      <span className="font-medium">{selected.size} selected</span>
      <input className="h-7 w-40 px-2 rounded border border-border bg-transparent"
             placeholder="campaign (optional)"
             value={campaign} onChange={e => setCampaign(e.target.value)} />
      <button className="h-7 px-3 rounded bg-primary text-primary-foreground disabled:opacity-50"
              disabled={busy || !currentUser} onClick={createTargets}>
        {busy ? "Creating…" : `Create ${selected.size} target(s)`}
      </button>
      {!saveOpen ? (
        <button className="h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground"
                onClick={() => setSaveOpen(true)}>
          save for later
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          {active ? (
            <span className="text-muted-foreground">→ "{active.name}"
              <button className="text-primary hover:underline ml-1"
                      onClick={() => { setActive(null); setActiveList(null); }}>change</button>
            </span>
          ) : (
            <>
              <input className="h-7 w-36 px-2 rounded border border-border bg-transparent"
                     placeholder="new list name" value={newListName}
                     onChange={e => setNewListName(e.target.value)} />
              {(lists.data?.length ?? 0) > 0 && (
                <select className="h-7 px-1 rounded border border-border bg-transparent" value=""
                        onChange={e => {
                          const l = (lists.data ?? []).find((x: any) => x.id === Number(e.target.value));
                          if (l) { const v = { id: l.id, name: l.name }; setActive(v); setActiveList(v); }
                        }}>
                  <option value="">or pick…</option>
                  {(lists.data ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
            </>
          )}
          <input className="h-7 w-48 px-2 rounded border border-border bg-transparent"
                 placeholder="note — why these?" value={note} onChange={e => setNote(e.target.value)} />
          <button className="h-7 px-2 rounded border border-primary text-primary disabled:opacity-50"
                  disabled={saving} onClick={saveForLater}>{saving ? "…" : "Save"}</button>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setSaveOpen(false)}>cancel</button>
        </span>
      )}
      <button className="h-7 px-2 rounded border border-border text-muted-foreground ml-auto" onClick={clear}>
        Clear
      </button>
    </div>
  );
}


/** Preview + dismiss drawer for a directory row (unchanged behavior). */
function PreviewBox({ path, root, onChanged, currentUser }:
  { path: string; root: string; onChanged: () => void; currentUser: string | null }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pv = useQuery({
    queryKey: ["recon-preview", root, path],
    queryFn: () => rapi(`/preview?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`),
  });
  if (pv.isLoading) return <Loading label="Analyzing tree" />;
  if (!pv.data) return null;
  const d = pv.data;

  const doDismiss = async () => {
    if (!note.trim()) { setErr("The note is the point — say why this is fine."); return; }
    setSaving(true);
    try {
      await rapi("/dismissals", { method: "POST", body: JSON.stringify({ root, path, note }) }, currentUser);
      onChanged();
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  };

  const undismiss = async (id: number) => {
    try {
      await rapi(`/dismissals/${id}`, { method: "DELETE" }, currentUser);
      onChanged();
    } catch (e: any) { toast(e.message, "error"); }
  };

  return (
    <div className="p-3 bg-muted/10 text-xs space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
        <span>{d.files.toLocaleString()} files</span>
        <span>{formatBytes(d.bytes)}</span>
        <span>{fmtDensity(d.files, d.bytes)}</span>
        <span>mtimes {fmtDate(d.oldest_mtime)} → {fmtDate(d.newest_mtime)}</span>
      </div>
      {d.dismissal && (
        <div className="px-2 py-1 rounded border border-border/60 bg-muted/30">
          Dismissed by <strong>{d.dismissal.by}</strong> ({String(d.dismissal.at).slice(0, 10)}):
          {" "}<em>{d.dismissal.note}</em>
          {" "}<button className="text-primary hover:underline" onClick={() => undismiss(d.dismissal.id)}>un-dismiss</button>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <div className="text-muted-foreground mb-0.5">Extensions (by bytes)</div>
          {d.extensions.map((e: any) => (
            <div key={e.ext} className="flex justify-between font-mono">
              <span>.{e.ext}</span><span>{formatBytes(e.bytes)} · {e.files.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Owners</div>
          {d.owners.map((o: any) => (
            <div key={o.owner} className="flex justify-between font-mono">
              <span>{o.owner}</span><span>{formatBytes(o.bytes)}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">Largest files</div>
          {d.samples.map((f: any) => (
            <div key={f.path} className="font-mono truncate" title={f.path}>
              {formatBytes(f.bytes)} — {f.path.slice(path.length + 1) || f.path}
            </div>
          ))}
        </div>
      </div>
      {!d.dismissal && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            className="h-7 px-2 rounded border border-border bg-transparent flex-1 min-w-[260px]"
            placeholder="Why is this fine as-is? The note sticks to the path."
            value={note}
            onChange={e => { setNote(e.target.value); setErr(null); }}
            onKeyDown={e => e.key === "Enter" && doDismiss()}
          />
          <button className="h-7 px-3 rounded border border-border hover:bg-muted/30 disabled:opacity-50"
                  disabled={saving} onClick={doDismiss}>
            {saving ? "…" : "Reviewed — dismiss"}
          </button>
          {err && <span className="text-red-500">{err}</span>}
        </div>
      )}
    </div>
  );
}


/** Duplicates: grouped table, checkboxes on individual copies only. */
function DuplicatesMethod({ root, selected, toggle }: {
  root: string; selected: Map<string, FindRow>;
  toggle: (row: FindRow, source: string) => void;
}) {
  const [showSiblings, setShowSiblings] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const dups = useQuery({
    queryKey: ["recon-dups", root, showSiblings],
    queryFn: () => rapi(`/duplicates?root=${encodeURIComponent(root)}&include_siblings=${showSiblings}`),
  });
  if (dups.isLoading) return <Loading label="Matching by basename and size" />;
  return (
    <>
      <div className="text-[11px] px-2.5 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
        {dups.data?.caveat} Checkboxes are on individual copies (open a group) —
        never on a whole group, so you cannot accidentally select every copy of a file.
      </div>
      {(dups.data?.hidden_sibling_groups ?? 0) > 0 && !showSiblings && (
        <button className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowSiblings(true)}>
          {dups.data.hidden_sibling_groups} group(s) hidden as probable scenario siblings
          (copies split only deep in the tree) — show them
        </button>
      )}
      {showSiblings && (
        <button className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowSiblings(false)}>hide sibling groups</button>
      )}
      <table className="w-full text-xs">
        <thead><tr className="text-left text-muted-foreground border-b border-border/40">
          <th className="w-6"></th>
          <th className="px-2 py-1.5">Basename</th>
          <th className="px-2 py-1.5 text-right">Size each</th>
          <th className="px-2 py-1.5 text-right">Copies</th>
          <th className="px-2 py-1.5 text-right" title="size × extra copies">Wasted</th>
          <th className="px-2 py-1.5 text-right" title="Directory level (below root) where the copies' trees separate — low = unrelated trees, high = scenario siblings">Split at</th>
          <th className="px-2 py-1.5">Owners</th>
        </tr></thead>
        <tbody>
          {(dups.data?.rows ?? []).map((r: any) => {
            const key = r.name + r.bytes;
            return (
              <>
                <tr key={key} className={cn("border-b border-border/20 hover:bg-muted/20", r.sibling_group && "opacity-50")}>
                  <td className="px-1 py-1">
                    <button className="text-muted-foreground hover:text-foreground"
                            onClick={() => setOpen(open === key ? null : key)}>
                      {open === key ? "▾" : "▸"}
                    </button>
                  </td>
                  <td className="px-2 py-1 font-mono truncate max-w-[320px]" title={r.name}>{r.name}</td>
                  <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                  <td className="px-2 py-1 text-right font-mono">×{r.copies}</td>
                  <td className="px-2 py-1 text-right font-mono font-semibold">{formatBytes(r.wasted)}</td>
                  <td className="px-2 py-1 text-right font-mono">L{r.diverge_level}{r.sibling_group ? " (sibling)" : ""}</td>
                  <td className="px-2 py-1 font-mono">{[...new Set(r.owners as string[])].join(", ")}</td>
                </tr>
                {open === key && (
                  <tr key={key + ":x"}>
                    <td colSpan={7} className="border-b border-border/30 bg-muted/10 px-3 py-2">
                      {r.paths.map((p: string, i: number) => (
                        <div key={p} className="flex items-center gap-2 font-mono text-[11px]">
                          <input type="checkbox" checked={selected.has(p)}
                                 onChange={() => toggle(
                                   { path: p, bytes: r.bytes, files: 1, kind: "file", owner: r.owners[i] },
                                   `find:dup:${r.name}`)} />
                          <span className="truncate" title={p}>{p}</span>
                          <span className="text-muted-foreground">({r.owners[i]})</span>
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </>
  );
}


/** Patterns & size: predicate-based find. Adoption preserves the predicate,
 *  so it uses /candidates/adopt (not the generic per-path creation) — what
 *  you scanned is exactly what the target selects. */
function PatternsMethod({ root, selected, toggle, Check, clear, onTargetsCreated, onProtectionsChanged }: {
  root: string; selected: Map<string, FindRow>;
  toggle: (row: FindRow, source: string) => void;
  Check: (p: { row: FindRow; source: string }) => JSX.Element;
  clear: () => void;
  onTargetsCreated: () => void;
  onProtectionsChanged: () => void;
}) {
  const { currentUser } = useAppStore();
  const [include, setInclude] = useState(".log, .err");
  const [exclude, setExclude] = useState("");
  const [sizeMinMB, setSizeMinMB] = useState("");
  const [sizeMaxMB, setSizeMaxMB] = useState("100");
  const [minAgeDays, setMinAgeDays] = useState("180");
  const [dirSegment, setDirSegment] = useState("");
  const [scan, setScan] = useState<any | null>(null);
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
    root, include, exclude,
    size_min: mb(sizeMinMB), size_max: mb(sizeMaxMB),
    min_age_days: parseInt(minAgeDays) > 0 ? parseInt(minAgeDays) : null,
    dir_segment: dirSegment,
  });

  const applyPreset = (pr: any) => {
    setInclude(pr.include); setExclude(pr.exclude);
    setSizeMinMB(pr.size_min); setSizeMaxMB(pr.size_max_mb);
    setMinAgeDays(pr.min_age_days); setDirSegment(pr.dir_segment);
    setScan(null); setSamplePath(null);
  };

  const run = async () => {
    setBusy(true);
    setSamplePath(null);
    try {
      const d = await api("/candidates/find", { method: "POST", body: JSON.stringify(findBody()) });
      setScan(d);
    } catch (e: any) { toast(e.message, "error"); }
    setBusy(false);
  };

  const toggleSample = async (path: string) => {
    if (samplePath === path) { setSamplePath(null); return; }
    setSamplePath(path);
    setSample(null);
    try {
      const d = await api("/candidates/sample", { method: "POST", body: JSON.stringify({ ...findBody(), path }) });
      setSample(d);
    } catch (e: any) { toast(e.message, "error"); setSamplePath(null); }
  };

  // Predicate-aware creation replaces the generic bar action for this method.
  const patternPaths = [...selected.entries()]
    .filter(([, r]) => r.kind === "dir").map(([p]) => p);
  const adopt = async () => {
    setBusy(true);
    try {
      const d = await api("/candidates/adopt", {
        method: "POST",
        body: JSON.stringify({ ...findBody(), paths: patternPaths, campaign: campaign.trim() || null }),
      }, currentUser);
      const parts = [];
      if (d.created.length) parts.push(`${d.created.length} target(s) created`);
      if (d.existing.length) parts.push(
        `${d.existing.length} already existed (${d.existing.map((e: any) => `#${e.target_id}`).join(", ")}) — pointed at, not duplicated`);
      toast(parts.join("; ") || "nothing to adopt", d.created.length ? "success" : "info");
      clear();
      onTargetsCreated();
    } catch (e: any) { toast(e.message, "error"); }
    setBusy(false);
  };

  const emptyNoExcludes = mb(sizeMaxMB) === 0 && !exclude.trim();

  return (
    <div className="space-y-2 text-xs">
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
      </div>

      {emptyNoExcludes && (
        <div className="px-2.5 py-1.5 rounded border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          You are including empty files with no exclusions. Zero-byte pipeline sentinels
          look identical to zero-byte garbage — exclude the sentinel names you know
          (the "Empty files" preset fills them in).
        </div>
      )}

      {busy && !scan && <Loading label="Searching" />}

      {scan && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-3 py-2 rounded-md border border-border/60 bg-muted/10">
            <span className="text-base font-semibold font-mono">{scan.total_files.toLocaleString()} files</span>
            <span className="text-base font-semibold font-mono">{formatBytes(scan.total_bytes)}</span>
            <span className="text-muted-foreground">
              across {scan.groups_shown} group(s){scan.groups_truncated ? " (list truncated at 200 — totals cover everything)" : ""}
            </span>
          </div>
          <div className="max-h-96 overflow-y-auto border border-border/40 rounded">
            <table className="w-full">
              <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                <th className="px-2 py-1.5 w-6"></th>
                <th className="px-2 py-1.5 w-6"></th>
                <th className="px-2 py-1.5">Path</th>
                <th className="px-2 py-1.5 text-right">Size</th>
                <th className="px-2 py-1.5 text-right">Files</th>
                <th className="px-2 py-1.5">Likely owner</th>
              </tr></thead>
              <tbody>
                {scan.groups.map((g: any) => {
                  const row: FindRow = {
                    path: g.path, bytes: g.bytes, files: g.files, kind: "dir",
                    owner: g.suggest_assignment ? g.suggested_owner : null,
                    ownerConf: g.suggest_assignment ? g.owner_confidence : null,
                  };
                  return (
                    <>
                      <tr key={g.path} className="border-b border-border/20 hover:bg-muted/20">
                        <td className="px-2 py-1"><Check row={row} source="find:patterns" /></td>
                        <td className="px-1 py-1">
                          <button className="text-muted-foreground hover:text-foreground"
                                  title="Sample: 20 real paths, subtree and extension breakdown"
                                  onClick={() => toggleSample(g.path)}>
                            {samplePath === g.path ? "▾" : "▸"}
                          </button>
                        </td>
                        <td className="px-2 py-1 font-mono truncate max-w-[360px]" title={g.path}>{g.path}</td>
                        <td className="px-2 py-1 text-right font-mono">{formatBytes(g.bytes)}</td>
                        <td className="px-2 py-1 text-right font-mono">{g.files.toLocaleString()}</td>
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
                  );
                })}
                {scan.groups.length === 0 && <tr><td colSpan={6} className="px-2 py-3 text-center text-muted-foreground">No matches.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Predicate-preserving creation: the bar's generic action would drop
              the patterns, so this method carries its own create button. */}
          {patternPaths.length > 0 && (
            <div className="sticky bottom-0 px-3 py-2 border-t-2 border-primary/40 bg-card rounded-b-md flex flex-wrap items-center gap-2 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
              <span className="font-medium">{patternPaths.length} selected</span>
              <input className="h-7 w-40 px-2 rounded border border-border bg-transparent"
                     placeholder="campaign (optional)"
                     value={campaign} onChange={e => setCampaign(e.target.value)} />
              <button className="h-7 px-3 rounded bg-primary text-primary-foreground disabled:opacity-50"
                      disabled={busy || !currentUser} onClick={adopt}>
                Create {patternPaths.length} target(s) with this pattern
              </button>
              <span className="text-muted-foreground">
                targets keep the include/exclude/size/age filter — what you scanned is what they select
              </span>
            </div>
          )}

          <ProtectionsLine segments={scan.protected_segments} onChanged={() => { run(); onProtectionsChanged(); }} />
        </>
      )}
    </div>
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
      {(segments ?? []).map(x => <code key={x} className="px-1 rounded bg-muted/30">{x}/</code>)}
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


/** Sweep: the one method that cannot preview into the shared table — the
 *  API analyzes and creates in a single call. The button says what it does. */
function SweepMethod({ root, onSwept }: { root: string; onSwept: () => void }) {
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
    <div className="space-y-2 text-xs">
      <div className="px-2.5 py-1.5 rounded border border-border/60 bg-muted/10 text-muted-foreground">
        Sweep skips the result table: it analyzes the whole tree and <strong>creates the
        targets in one call</strong>, assigned to their majority owners. A group matching ANY
        threshold becomes a target (≥60% owner confidence; otherwise left unassigned rather
        than guessed). Re-running skips existing targets.
      </div>
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
        <label className="flex flex-col gap-1" title="Groups whose newest file is older than this (mtime — see the Age method caveat)">
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
          {busy ? "Sweeping…" : "Run sweep — creates targets"}
        </button>
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
  );
}


/** Saved selections (custom lists): reload a previous selection and turn it
 *  into targets. Conversion uses the existing to-worklist call, which takes
 *  the whole list — remove items first to trim it. */
function SavedMethod({ onTargetsCreated }: { onTargetsCreated: () => void }) {
  const { currentUser } = useAppStore();
  const qc = useQueryClient();
  const [active, setActive] = useState(activeList());
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);
  const lists = useQuery({ queryKey: ["hk-lists"], queryFn: () => rapi("/lists") });
  const items = useQuery({
    queryKey: ["hk-list-items", active?.id],
    queryFn: () => rapi(`/lists/${active!.id}/items`),
    enabled: !!active,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["hk-lists"] });
    qc.invalidateQueries({ queryKey: ["hk-list-items"] });
  };

  const convert = async () => {
    if (!arming) { setArming(true); setTimeout(() => setArming(false), 4000); return; }
    setBusy(true);
    try {
      const d = await rapi(`/lists/${active!.id}/to-worklist`, { method: "POST" }, currentUser);
      toast(`${d.created.length} target(s) created under campaign "${d.campaign}"`, "success");
      onTargetsCreated();
    } catch (e: any) { toast(e.message, "error"); }
    setBusy(false);
    setArming(false);
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Saved selection:</span>
        {lists.isLoading ? <span className="text-muted-foreground">loading…</span> : (
          <select className="h-7 px-2 rounded border border-border bg-transparent"
                  value={active?.id ?? ""}
                  onChange={e => {
                    const l = (lists.data ?? []).find((x: any) => x.id === Number(e.target.value));
                    const v = l ? { id: l.id, name: l.name } : null;
                    setActive(v); setActiveList(v);
                  }}>
            <option value="">— pick one —</option>
            {(lists.data ?? []).map((l: any) => (
              <option key={l.id} value={l.id}>{l.name} ({l.items} items, {formatBytes(l.bytes)})</option>
            ))}
          </select>
        )}
        {active && (items.data?.length ?? 0) > 0 && (
          <button className={cn("h-7 px-3 rounded border",
                    arming ? "border-amber-500 text-amber-600" : "border-primary text-primary")}
                  disabled={busy} onClick={convert}>
            {busy ? "Creating…" : arming ? "Click again to confirm"
              : `Create ${items.data.length} target(s) from this list`}
          </button>
        )}
        {(lists.data?.length ?? 0) === 0 && !lists.isLoading && (
          <span className="text-muted-foreground">
            Nothing saved yet — select rows in any method and use "save for later".
          </span>
        )}
      </div>
      {active && items.isLoading && <Loading label="Loading list" />}
      {active && (items.data?.length ?? 0) > 0 && (
        <table className="w-full">
          <thead><tr className="text-left text-muted-foreground border-b border-border/40">
            <th className="px-2 py-1.5">Path</th>
            <th className="px-2 py-1.5"></th>
            <th className="px-2 py-1.5 text-right">Size</th>
            <th className="px-2 py-1.5 text-right">Files</th>
            <th className="px-2 py-1.5">Saved from</th>
            <th className="px-2 py-1.5"></th>
          </tr></thead>
          <tbody>
            {items.data!.map((it: any) => (
              <tr key={it.path_hash} className="border-b border-border/20">
                <td className="px-2 py-1 font-mono truncate max-w-[420px]" title={it.path}>{it.path}</td>
                <td className="px-2 py-1 text-muted-foreground">{it.kind}</td>
                <td className="px-2 py-1 text-right font-mono">{formatBytes(it.bytes)}</td>
                <td className="px-2 py-1 text-right font-mono">{it.files.toLocaleString()}</td>
                <td className="px-2 py-1 text-muted-foreground truncate max-w-[220px]" title={it.source}>{it.source}</td>
                <td className="px-2 py-1">
                  <button className="text-red-500/70 hover:text-red-500"
                          onClick={async () => {
                            try {
                              await rapi(`/lists/${active.id}/items/${it.path_hash}`, { method: "DELETE" }, currentUser);
                              invalidate();
                            } catch (e: any) { toast(e.message, "error"); }
                          }}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
