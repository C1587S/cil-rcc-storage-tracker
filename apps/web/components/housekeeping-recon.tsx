"use client";

/**
 * Reconnaissance report: see where the problem is BEFORE deciding anything.
 * Six views over the same snapshot, every row a drill target:
 *   Age (default) -> coldest maximal subtrees
 *   Directories   -> file-count pressure (inodes), bytes beside counts
 *   Owners        -> who holds what; click through to their directories
 *   Largest       -> biggest single files across the root
 *   Duplicates    -> same basename + same size above a threshold
 *   Path detail   -> file detail; the view everything else drills into
 *
 * Interaction rules learned the hard way:
 *  - No native alert/confirm/prompt anywhere. Errors and prerequisites
 *    render inline, next to the control that raised them.
 *  - Never block on state the user didn't know existed: adding to a list
 *    with no active list opens the picker and then completes the add.
 *  - Notes are captured at the moment of action, when the reason is known.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { API_BASE_URL } from "@/lib/api";
import { activeList, setActiveList, toast, currentIdentity } from "@/lib/hk";
import { GridLoader } from "@/components/ui/grid-loader";
import { formatBytes } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";

type Tab = "age" | "dirs" | "owners" | "largest" | "dups" | "files";

async function rapi(path: string, opts: RequestInit = {}, user?: string | null) {
  const uid = user ?? currentIdentity();
  const res = await fetch(`${API_BASE_URL}/api/housekeeping/recon${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
      ...(uid ? { "X-User": uid } : {}),
    },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`recon API ${res.status} ${path}:`, d?.detail || d);
    throw new Error(d?.detail || `Request failed (${res.status})`);
  }
  return d;
}

const fmtAge = (epoch: number) => {
  if (!epoch) return "—";
  const days = (Date.now() / 1000 - epoch) / 86400;
  if (days >= 365) return `${(days / 365).toFixed(1)} y`;
  if (days >= 30) return `${Math.round(days / 30)} mo`;
  return `${Math.max(0, Math.round(days))} d`;
};
const fmtDate = (epoch: number) => (epoch ? new Date(epoch * 1000).toISOString().slice(0, 10) : "—");

/** files per GB — the disagreement channel between inodes and bytes */
const density = (files: number, bytes: number) =>
  bytes > 0 ? files / (bytes / 1024 ** 3) : files > 0 ? Infinity : 0;
const fmtDensity = (files: number, bytes: number) => {
  const d = density(files, bytes);
  if (!isFinite(d)) return "∞";
  if (d >= 1000) return `${(d / 1000).toFixed(1)}K/GB`;
  return `${d.toFixed(d < 10 ? 1 : 0)}/GB`;
};

function useSorted<T extends Record<string, any>>(rows: T[] | undefined, initial: string) {
  const [key, setKey] = useState(initial);
  const [desc, setDesc] = useState(true);
  const sorted = useMemo(() => {
    const r = [...(rows ?? [])];
    r.sort((a, b) => {
      const get = (x: any) =>
        key === "__density" ? density(x.files ?? 0, x.bytes ?? 0) : x[key] ?? 0;
      const av = get(a), bv = get(b);
      const c = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return desc ? -c : c;
    });
    return r;
  }, [rows, key, desc]);
  const TH = ({ k, label, right, title }: { k: string; label: string; right?: boolean; title?: string }) => (
    <th className={cn("px-2 py-1.5 whitespace-nowrap", right && "text-right")} title={title}>
      <button className="hover:text-foreground"
              onClick={() => (key === k ? setDesc(!desc) : (setKey(k), setDesc(true)))}>
        {label}{key === k ? (desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  return { sorted, TH };
}

function Loading({ label }: { label: string }) {
  return (
    <div className="py-8 flex justify-center">
      <GridLoader label={label} />
    </div>
  );
}

export function ReconPanel({ root }: { root: string }) {
  const { currentUser } = useAppStore();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("age");
  const [minAgeDays, setMinAgeDays] = useState(365);
  const [drill, setDrill] = useState<{ prefix: string; owner?: string } | null>(null);
  const [ownerDrill, setOwnerDrill] = useState<string | null>(null);
  const [active, setActive] = useState(activeList());
  const [showDismissed, setShowDismissed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Selection + the add flow (bar at the bottom of the panel)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addNote, setAddNote] = useState("");
  const [addSource, setAddSource] = useState("recon");
  const [newListName, setNewListName] = useState("");
  const [addStatus, setAddStatus] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const enabled = (t: Tab) => tab === t;
  const age = useQuery({
    queryKey: ["recon-age", root, minAgeDays, showDismissed],
    queryFn: () => rapi(`/age?root=${encodeURIComponent(root)}&min_age_days=${minAgeDays}&include_dismissed=${showDismissed}`),
    enabled: enabled("age"),
  });
  const dirs = useQuery({
    queryKey: ["recon-dirs", root, showDismissed],
    queryFn: () => rapi(`/dirs?root=${encodeURIComponent(root)}&include_dismissed=${showDismissed}`),
    enabled: enabled("dirs"),
  });
  const owners = useQuery({
    queryKey: ["recon-owners", root],
    queryFn: () => rapi(`/owners?root=${encodeURIComponent(root)}`),
    enabled: enabled("owners"),
  });
  const ownerDirs = useQuery({
    queryKey: ["recon-odirs", root, ownerDrill],
    queryFn: () => rapi(`/owner-dirs?root=${encodeURIComponent(root)}&owner=${encodeURIComponent(ownerDrill!)}`),
    enabled: enabled("owners") && !!ownerDrill,
  });
  const largest = useQuery({
    queryKey: ["recon-largest", root],
    queryFn: () => rapi(`/largest?root=${encodeURIComponent(root)}`),
    enabled: enabled("largest"),
  });
  const [showSiblingDups, setShowSiblingDups] = useState(false);
  const dups = useQuery({
    queryKey: ["recon-dups", root, showSiblingDups],
    queryFn: () => rapi(`/duplicates?root=${encodeURIComponent(root)}&include_siblings=${showSiblingDups}`),
    enabled: enabled("dups"),
  });
  const files = useQuery({
    queryKey: ["recon-files", root, drill?.prefix, drill?.owner],
    queryFn: () => rapi(
      `/files?root=${encodeURIComponent(root)}&prefix=${encodeURIComponent(drill!.prefix)}`
      + (drill?.owner ? `&owner=${encodeURIComponent(drill.owner)}` : "")),
    enabled: enabled("files") && !!drill,
  });

  const lists = useQuery({ queryKey: ["hk-lists"], queryFn: () => rapi("/lists") });
  const listItems = useQuery({
    queryKey: ["hk-list-items", active?.id],
    queryFn: () => rapi(`/lists/${active!.id}/items`),
    enabled: !!active,
  });

  const invalidateRecon = () => {
    ["recon-age", "recon-dirs", "recon-preview"].forEach(k =>
      qc.invalidateQueries({ queryKey: [k] }));
  };
  const invalidateLists = () => {
    qc.invalidateQueries({ queryKey: ["hk-lists"] });
    qc.invalidateQueries({ queryKey: ["hk-list-items"] });
  };

  // ----- the add flow: never a dead end -----
  const toggleSelect = (path: string, source: string) => {
    setAddSource(source);
    setSelected(prev => {
      const n = new Set(prev);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });
    setAddStatus(null);
  };

  const createListAndActivate = async (): Promise<{ id: number; name: string } | null> => {
    const name = newListName.trim();
    if (!name) {
      setAddStatus("Give the new list a name first.");
      return null;
    }
    const d = await rapi("/lists", { method: "POST", body: JSON.stringify({ name, root }) }, currentUser);
    const l = { id: d.id, name };
    setActive(l); setActiveList(l); setNewListName("");
    invalidateLists();
    return l;
  };

  const completeAdd = async () => {
    if (selected.size === 0) return;
    setAdding(true);
    setAddStatus(null);
    try {
      let list = active;
      if (!list) {
        list = await createListAndActivate();
        if (!list) { setAdding(false); return; }
      }
      const d = await rapi(`/lists/${list.id}/items`, {
        method: "POST",
        body: JSON.stringify({
          paths: [...selected],
          source: addNote.trim() ? `${addSource} — ${addNote.trim()}` : addSource,
        }),
      }, currentUser);
      const rej = d.rejected?.length ? ` · ${d.rejected.length} rejected (${d.rejected[0].reason})` : "";
      setAddStatus(`Added ${d.added.length} to "${list.name}"${rej}`);
      setSelected(new Set());
      setAddNote("");
      invalidateLists();
    } catch (e: any) {
      setAddStatus(`Failed: ${e.message}`);
    }
    setAdding(false);
  };

  const drillToFiles = (prefix: string, owner?: string) => {
    setDrill({ prefix, owner });
    setTab("files");
  };

  const undismiss = async (id: number) => {
    try {
      await rapi(`/dismissals/${id}`, { method: "DELETE" }, currentUser);
      invalidateRecon();
    } catch (e: any) { toast(e.message, "error"); }
  };

  // Everything needed to judge a tree without leaving the panel —
  // including the dismissal control, inline, with its note field.
  function PreviewBox({ path }: { path: string }) {
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
        invalidateRecon();
      } catch (e: any) { setErr(e.message); }
      setSaving(false);
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

  const Check = ({ path, source }: { path: string; source: string }) => (
    <input type="checkbox" checked={selected.has(path)}
           onChange={() => toggleSelect(path, source)} />
  );

  const PathCell = ({ path, owner }: { path: string; owner?: string }) => (
    <button className="font-mono text-left hover:underline truncate max-w-[420px] block"
            title={`${path} — click for file detail`}
            onClick={() => drillToFiles(path, owner)}>
      {path.slice(root.length) || "/"}
    </button>
  );

  const DensityCell = ({ files, bytes }: { files: number; bytes: number }) => (
    <td className={cn("px-2 py-1 text-right font-mono",
      density(files, bytes) >= 1000 && "text-amber-600 dark:text-amber-400 font-semibold")}>
      {fmtDensity(files, bytes)}
    </td>
  );

  const ageSort = useSorted(age.data?.rows, "bytes");
  const dirSort = useSorted(dirs.data?.rows, "files");
  const ownerSort = useSorted(owners.data?.rows, "bytes");
  const largeSort = useSorted(largest.data?.rows, "bytes");
  const dupSort = useSorted(dups.data?.rows, "wasted");
  const fileSort = useSorted(files.data?.rows, "bytes");

  return (
    <div className="border border-border/60 rounded-md">
      <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
        <span className="text-xs font-medium mr-2">Reconnaissance</span>
        {([["age", "Age"], ["dirs", "Directories"], ["owners", "Owners"],
           ["largest", "Largest files"], ["dups", "Duplicates"],
           ["files", "Path detail"]] as [Tab, string][]).map(([t, l]) => (
          <button key={t}
                  className={cn("px-2.5 h-7 text-xs rounded-t border-b-2 transition-colors",
                    tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
                  onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">{root}</span>
      </div>

      <div className="p-3 border-t border-border/40 space-y-2">
        {/* ---------------- AGE ---------------- */}
        {tab === "age" && (
          <>
            <div className="text-[11px] px-2.5 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              Measures time since last <strong>modification</strong> (mtime) anywhere in the subtree.
              Reading a file does not update mtime, and atime is unreliable on this mount —
              "not modified" is <strong>not</strong> "unused". A reference dataset can be read weekly
              and written never.
            </div>
            <div className="flex items-center gap-2 text-xs">
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
              {(age.data?.hidden_dismissed ?? 0) > 0 && !showDismissed && (
                <button className="text-[11px] text-muted-foreground hover:text-foreground ml-2"
                        onClick={() => setShowDismissed(true)}>
                  {age.data.hidden_dismissed} dismissed hidden — show
                </button>
              )}
              {showDismissed && (
                <button className="text-[11px] text-muted-foreground hover:text-foreground ml-2"
                        onClick={() => setShowDismissed(false)}>hide dismissed</button>
              )}
            </div>
            {age.isLoading ? <Loading label="Finding cold trees" /> : (
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                  <th className="w-6"></th><th className="w-6"></th>
                  <th className="px-2 py-1.5">Cold subtree (whole tree unmodified)</th>
                  {ageSort.TH({ k: "bytes", label: "Would free", right: true })}
                  {ageSort.TH({ k: "files", label: "Files", right: true })}
                  {ageSort.TH({ k: "__density", label: "Files/GB", right: true, title: "High density = inode problem, not byte problem" })}
                  {ageSort.TH({ k: "last_modified", label: "Last modified", right: true })}
                </tr></thead>
                <tbody>
                  {ageSort.sorted.map((r: any) => (
                    <>
                      <tr key={r.path} className={cn("border-b border-border/20 hover:bg-muted/20", r.dismissed && "opacity-50")}>
                        <td className="px-1 py-1"><Check path={r.path} source={`recon:age>${minAgeDays}d`} /></td>
                        <td className="px-1 py-1">
                          <button className="text-muted-foreground hover:text-foreground"
                                  title="Preview: samples, extensions, owners, dates — and dismiss"
                                  onClick={() => setExpanded(expanded === r.path ? null : r.path)}>
                            {expanded === r.path ? "▾" : "▸"}
                          </button>
                        </td>
                        <td className="px-2 py-1">
                          <PathCell path={r.path} />
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
                        <DensityCell files={r.files} bytes={r.bytes} />
                        <td className="px-2 py-1 text-right font-mono" title={fmtDate(r.last_modified)}>
                          {fmtAge(r.last_modified)} ago
                        </td>
                      </tr>
                      {expanded === r.path && (
                        <tr key={r.path + ":pv"}><td colSpan={7} className="border-b border-border/30"><PreviewBox path={r.path} /></td></tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {/* ---------------- DIRECTORIES ---------------- */}
        {tab === "dirs" && (
          dirs.isLoading ? <Loading label="Ranking by file count" /> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                <th className="w-6"></th><th className="w-6"></th>
                <th className="px-2 py-1.5">Directory</th>
                {dirSort.TH({ k: "files", label: "Files (recursive)", right: true })}
                {dirSort.TH({ k: "direct_files", label: "Files (direct)", right: true })}
                {dirSort.TH({ k: "bytes", label: "Bytes", right: true })}
                {dirSort.TH({ k: "__density", label: "Files/GB", right: true, title: "High density = inode problem, not byte problem" })}
                {dirSort.TH({ k: "last_modified", label: "Last mod", right: true })}
              </tr></thead>
              <tbody>
                {dirSort.sorted.map((r: any) => (
                  <>
                    <tr key={r.path} className={cn("border-b border-border/20 hover:bg-muted/20", r.dismissed && "opacity-50")}>
                      <td className="px-1 py-1"><Check path={r.path} source="recon:dirs" /></td>
                      <td className="px-1 py-1">
                        <button className="text-muted-foreground hover:text-foreground"
                                onClick={() => setExpanded(expanded === r.path ? null : r.path)}>
                          {expanded === r.path ? "▾" : "▸"}
                        </button>
                      </td>
                      <td className="px-2 py-1">
                        <PathCell path={r.path} />
                        {r.dismissed && <div className="text-[10px] text-muted-foreground italic">dismissed: {r.dismissed.note}</div>}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{r.files.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right font-mono">{r.direct_files.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                      <DensityCell files={r.files} bytes={r.bytes} />
                      <td className="px-2 py-1 text-right font-mono">{fmtAge(r.last_modified)}</td>
                    </tr>
                    {expanded === r.path && (
                      <tr key={r.path + ":pv"}><td colSpan={8} className="border-b border-border/30"><PreviewBox path={r.path} /></td></tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* ---------------- OWNERS ---------------- */}
        {tab === "owners" && (
          owners.isLoading ? <Loading label="Aggregating by owner" /> : (
            <div className="grid gap-3 md:grid-cols-2">
              <table className="w-full text-xs self-start">
                <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                  <th className="px-2 py-1.5">Owner</th>
                  {ownerSort.TH({ k: "bytes", label: "Bytes", right: true })}
                  {ownerSort.TH({ k: "files", label: "Files", right: true })}
                  {ownerSort.TH({ k: "__density", label: "Files/GB", right: true })}
                </tr></thead>
                <tbody>
                  {ownerSort.sorted.map((r: any) => (
                    <tr key={r.owner}
                        className={cn("border-b border-border/20 hover:bg-muted/20 cursor-pointer",
                          ownerDrill === r.owner && "bg-primary/10")}
                        onClick={() => setOwnerDrill(r.owner)}>
                      <td className="px-2 py-1 font-mono">{r.owner}</td>
                      <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                      <td className="px-2 py-1 text-right font-mono">{r.files.toLocaleString()}</td>
                      <DensityCell files={r.files} bytes={r.bytes} />
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>
                {ownerDrill ? (
                  ownerDirs.isLoading ? <Loading label={`Scanning ${ownerDrill}'s directories`} /> : (
                    <>
                      <div className="text-xs font-medium mb-1">{ownerDrill} — biggest directories</div>
                      <table className="w-full text-xs">
                        <tbody>
                          {(ownerDirs.data?.rows ?? []).map((r: any) => (
                            <tr key={r.path} className="border-b border-border/20 hover:bg-muted/20">
                              <td className="px-1 py-1"><Check path={r.path} source={`recon:owner:${ownerDrill}`} /></td>
                              <td className="px-2 py-1"><PathCell path={r.path} owner={ownerDrill} /></td>
                              <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                              <td className="px-2 py-1 text-right font-mono">{r.files.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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

        {/* ---------------- LARGEST FILES ---------------- */}
        {tab === "largest" && (
          largest.isLoading ? <Loading label="Finding the largest files" /> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                <th className="w-6"></th>
                <th className="px-2 py-1.5">File</th>
                {largeSort.TH({ k: "bytes", label: "Size", right: true })}
                {largeSort.TH({ k: "owner", label: "Owner" })}
                {largeSort.TH({ k: "last_modified", label: "Last mod", right: true })}
              </tr></thead>
              <tbody>
                {largeSort.sorted.map((r: any) => (
                  <tr key={r.path} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="px-1 py-1"><Check path={r.path} source="recon:largest" /></td>
                    <td className="px-2 py-1 font-mono truncate max-w-[460px]" title={r.path}>
                      {r.path.slice(root.length)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                    <td className="px-2 py-1 font-mono">{r.owner}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmtAge(r.last_modified)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* ---------------- DUPLICATES ---------------- */}
        {tab === "dups" && (
          dups.isLoading ? <Loading label="Matching by basename and size" /> : (
            <>
              <div className="text-[11px] px-2.5 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                {dups.data?.caveat}
              </div>
              {(dups.data?.hidden_sibling_groups ?? 0) > 0 && (
                <button className="text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => setShowSiblingDups(true)}>
                  {dups.data.hidden_sibling_groups} group(s) hidden as probable scenario siblings
                  (copies split only deep in the tree) — show them
                </button>
              )}
              {showSiblingDups && (
                <button className="text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => setShowSiblingDups(false)}>hide sibling groups</button>
              )}
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                  <th className="w-6"></th>
                  <th className="px-2 py-1.5">Basename</th>
                  {dupSort.TH({ k: "bytes", label: "Size each", right: true })}
                  {dupSort.TH({ k: "copies", label: "Copies", right: true })}
                  {dupSort.TH({ k: "wasted", label: "Wasted", right: true, title: "size × extra copies" })}
                  {dupSort.TH({ k: "diverge_level", label: "Split at", right: true, title: "Directory level (below root) where the copies' trees separate — low = unrelated trees, high = scenario siblings" })}
                  <th className="px-2 py-1.5">Owners</th>
                </tr></thead>
                <tbody>
                  {dupSort.sorted.map((r: any) => (
                    <>
                      <tr key={r.name + r.bytes}
                          className={cn("border-b border-border/20 hover:bg-muted/20",
                            r.sibling_group && "opacity-50")}>
                        <td className="px-1 py-1">
                          <button className="text-muted-foreground hover:text-foreground"
                                  onClick={() => setExpanded(expanded === r.name + r.bytes ? null : r.name + r.bytes)}>
                            {expanded === r.name + r.bytes ? "▾" : "▸"}
                          </button>
                        </td>
                        <td className="px-2 py-1 font-mono truncate max-w-[320px]" title={r.name}>{r.name}</td>
                        <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                        <td className="px-2 py-1 text-right font-mono">×{r.copies}</td>
                        <td className="px-2 py-1 text-right font-mono font-semibold">{formatBytes(r.wasted)}</td>
                        <td className="px-2 py-1 text-right font-mono">L{r.diverge_level}{r.sibling_group ? " (sibling)" : ""}</td>
                        <td className="px-2 py-1 font-mono">{[...new Set(r.owners)].join(", ")}</td>
                      </tr>
                      {expanded === r.name + r.bytes && (
                        <tr key={r.name + r.bytes + ":x"}>
                          <td colSpan={7} className="border-b border-border/30 bg-muted/10 px-3 py-2">
                            {r.paths.map((p: string, i: number) => (
                              <div key={p} className="flex items-center gap-2 font-mono text-[11px]">
                                <Check path={p} source={`recon:dup:${r.name}`} />
                                <span className="truncate" title={p}>{p}</span>
                                <span className="text-muted-foreground">({r.owners[i]})</span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </>
          )
        )}

        {/* ---------------- PATH DETAIL ---------------- */}
        {tab === "files" && (
          !drill ? (
            <div className="text-xs text-muted-foreground py-4 text-center">
              Drill in from any other tab — click a directory or an owner's directory.
            </div>
          ) : files.isLoading ? <Loading label={`Listing ${drill.prefix}`} /> : (
            <>
              <div className="text-xs text-muted-foreground font-mono">
                {drill.prefix}{drill.owner ? ` — owner ${drill.owner}` : ""}
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                  <th className="w-6"></th>
                  <th className="px-2 py-1.5">File</th>
                  {fileSort.TH({ k: "bytes", label: "Size", right: true })}
                  {fileSort.TH({ k: "owner", label: "Owner" })}
                  {fileSort.TH({ k: "last_modified", label: "Modified", right: true })}
                  {fileSort.TH({ k: "created", label: "Created", right: true })}
                </tr></thead>
                <tbody>
                  {fileSort.sorted.map((r: any) => (
                    <tr key={r.path} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="px-1 py-1"><Check path={r.path} source="recon:files" /></td>
                      <td className="px-2 py-1 font-mono truncate max-w-[400px]" title={r.path}>
                        {r.path.slice(drill.prefix.length) || r.path.slice(root.length)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                      <td className="px-2 py-1 font-mono">{r.owner}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmtDate(r.last_modified)}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmtDate(r.created)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        )}
      </div>

      {/* -------- the add bar: appears with a selection, never a dead end -------- */}
      {selected.size > 0 && (
        <div className="px-3 py-2 border-t-2 border-primary/40 bg-primary/5 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">{selected.size} selected</span>
          {active ? (
            <span className="text-muted-foreground">→ list "{active.name}"</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">→ new list:</span>
              <input className="h-7 px-2 rounded border border-border bg-transparent w-40"
                     placeholder="name it (e.g. dscim dupes)"
                     value={newListName}
                     onChange={e => setNewListName(e.target.value)} />
              {(lists.data?.length ?? 0) > 0 && (
                <>
                  <span className="text-muted-foreground">or pick:</span>
                  <select className="h-7 px-1 rounded border border-border bg-transparent"
                          value=""
                          onChange={e => {
                            const l = (lists.data ?? []).find((x: any) => x.id === Number(e.target.value));
                            if (l) { const v = { id: l.id, name: l.name }; setActive(v); setActiveList(v); }
                          }}>
                    <option value="">—</option>
                    {(lists.data ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </>
              )}
            </span>
          )}
          <input className="h-7 px-2 rounded border border-border bg-transparent flex-1 min-w-[220px]"
                 placeholder="Note — why these? (recorded with each item)"
                 value={addNote} onChange={e => setAddNote(e.target.value)}
                 onKeyDown={e => e.key === "Enter" && completeAdd()} />
          <button className="h-7 px-3 rounded bg-primary text-primary-foreground disabled:opacity-50"
                  disabled={adding} onClick={completeAdd}>
            {adding ? "Adding…" : `Add ${selected.size}`}
          </button>
          <button className="h-7 px-2 rounded border border-border text-muted-foreground"
                  onClick={() => { setSelected(new Set()); setAddStatus(null); }}>
            Clear
          </button>
          {addStatus && <span className={addStatus.startsWith("Failed") ? "text-red-500" : "text-emerald-600"}>{addStatus}</span>}
        </div>
      )}

      {/* -------- custom lists -------- */}
      <div className="px-3 py-2 border-t border-border/40 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">Custom lists</span>
          {lists.isLoading ? <span className="text-muted-foreground">loading…</span> : (
            <select className="h-7 px-2 rounded border border-border bg-transparent"
                    value={active?.id ?? ""}
                    onChange={e => {
                      const l = (lists.data ?? []).find((x: any) => x.id === Number(e.target.value));
                      const v = l ? { id: l.id, name: l.name } : null;
                      setActive(v); setActiveList(v);
                    }}>
              <option value="">— no active list —</option>
              {(lists.data ?? []).map((l: any) => (
                <option key={l.id} value={l.id}>{l.name} ({l.items} items, {formatBytes(l.bytes)})</option>
              ))}
            </select>
          )}
          {active && <ConvertButton listId={active.id} listName={active.name} onDone={() => {
            qc.invalidateQueries({ queryKey: ["hk-report"] });
          }} currentUser={currentUser} />}
          <span className="text-muted-foreground">
            Select rows anywhere above (or in the Tree / Treemap) to build a list; converting
            makes it a worklist — same assignment, CSV round trip and manifests as a sweep.
          </span>
        </div>
        {active && listItems.isLoading && <Loading label="Loading list" />}
        {active && (listItems.data?.length ?? 0) > 0 && (
          <table className="w-full text-xs">
            <tbody>
              {listItems.data!.map((it: any) => (
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
                                invalidateLists();
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
    </div>
  );
}

/** Two-step confirm, inline — no native confirm() */
function ConvertButton({ listId, listName, onDone, currentUser }:
  { listId: number; listName: string; onDone: () => void; currentUser: string | null }) {
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-1.5">
      <button className={cn("h-7 px-2 rounded border",
                arming ? "border-amber-500 text-amber-600" : "border-primary text-primary")}
              disabled={busy}
              onClick={async () => {
                if (!arming) { setArming(true); setTimeout(() => setArming(false), 4000); return; }
                setBusy(true);
                try {
                  const d = await rapi(`/lists/${listId}/to-worklist`, { method: "POST" }, currentUser);
                  setStatus(`${d.created.length} target(s) created under campaign "${d.campaign}"`);
                  onDone();
                } catch (e: any) { setStatus(`Failed: ${e.message}`); }
                setBusy(false);
                setArming(false);
              }}>
        {busy ? "Converting…" : arming ? "Click again to confirm" : "Convert to worklist"}
      </button>
      {status && <span className={status.startsWith("Failed") ? "text-red-500" : "text-emerald-600"}>{status}</span>}
    </span>
  );
}
