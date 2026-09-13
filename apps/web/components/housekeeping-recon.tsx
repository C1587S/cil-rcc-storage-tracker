"use client";

/**
 * Reconnaissance report: see where the problem is BEFORE deciding anything.
 * Five views over the same snapshot, every row a drill target:
 *   Age (default) -> coldest maximal subtrees, ranked by what they'd free
 *   Directories   -> file-count pressure (inodes), bytes beside counts
 *   Owners        -> who holds what; click through to their directories
 *   Largest       -> a few huge files; usually one conversation each
 *   Path          -> file detail; the view everything else drills into
 * Plus custom lists: hand-assembled worklists fed from any view.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { API_BASE_URL } from "@/lib/api";
import { activeList, setActiveList } from "@/lib/hk";
import { formatBytes } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";

type Tab = "age" | "dirs" | "owners" | "largest" | "files";

async function rapi(path: string, opts: RequestInit = {}, user?: string | null) {
  const res = await fetch(`${API_BASE_URL}/api/housekeeping/recon${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "X-User": user } : {}),
      ...(opts.headers || {}),
    },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.detail || String(res.status));
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

function useSorted<T extends Record<string, any>>(rows: T[] | undefined, initial: string) {
  const [key, setKey] = useState(initial);
  const [desc, setDesc] = useState(true);
  const sorted = useMemo(() => {
    const r = [...(rows ?? [])];
    r.sort((a, b) => {
      const av = a[key] ?? 0, bv = b[key] ?? 0;
      const c = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return desc ? -c : c;
    });
    return r;
  }, [rows, key, desc]);
  const TH = ({ k, label, right }: { k: string; label: string; right?: boolean }) => (
    <th className={cn("px-2 py-1.5 whitespace-nowrap", right && "text-right")}>
      <button className="hover:text-foreground"
              onClick={() => (key === k ? setDesc(!desc) : (setKey(k), setDesc(true)))}>
        {label}{key === k ? (desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  return { sorted, TH };
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

  const addPaths = useMutation({
    mutationFn: ({ paths, source }: { paths: string[]; source: string }) => {
      if (!active) return Promise.reject(new Error("Select an active list first (Custom lists below)."));
      return rapi(`/lists/${active.id}/items`, {
        method: "POST", body: JSON.stringify({ paths, source }),
      }, currentUser);
    },
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["hk-lists"] });
      qc.invalidateQueries({ queryKey: ["hk-list-items"] });
      if (d.rejected?.length) window.alert(`${d.rejected.length} rejected: ${d.rejected[0].reason}`);
    },
    onError: (e: Error) => window.alert(e.message),
  });

  const drillToFiles = (prefix: string, owner?: string) => {
    setDrill({ prefix, owner });
    setTab("files");
  };

  const invalidateRecon = () => {
    qc.invalidateQueries({ queryKey: ["recon-age"] });
    qc.invalidateQueries({ queryKey: ["recon-dirs"] });
    qc.invalidateQueries({ queryKey: ["recon-preview"] });
  };

  const dismissPath = async (path: string) => {
    const note = window.prompt(
      `Dismiss from recon:\n${path}\n\nWhy is this fine? (required — the note sticks to the path)`);
    if (!note?.trim()) return;
    try {
      await rapi("/dismissals", {
        method: "POST", body: JSON.stringify({ root, path, note }),
      }, currentUser);
      invalidateRecon();
    } catch (e: any) { window.alert(e.message); }
  };

  const undismiss = async (id: number) => {
    try {
      await rapi(`/dismissals/${id}`, { method: "DELETE" }, currentUser);
      invalidateRecon();
    } catch (e: any) { window.alert(e.message); }
  };

  // Everything needed to judge a tree without leaving the panel
  function PreviewBox({ path }: { path: string }) {
    const pv = useQuery({
      queryKey: ["recon-preview", root, path],
      queryFn: () => rapi(`/preview?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`),
    });
    if (pv.isLoading) return <div className="p-3 text-xs text-muted-foreground">loading preview…</div>;
    if (!pv.data) return null;
    const d = pv.data;
    return (
      <div className="p-3 bg-muted/10 text-xs space-y-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
          <span>{d.files.toLocaleString()} files</span>
          <span>{formatBytes(d.bytes)}</span>
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
          <div className="flex gap-3 pt-1">
            <button className="text-primary hover:underline" onClick={() => dismissPath(path)}>
              Reviewed — dismiss with note
            </button>
            <button className="text-primary hover:underline"
                    onClick={() => addPaths.mutate({ paths: [path], source: "recon:preview" })}>
              Add to list
            </button>
          </div>
        )}
      </div>
    );
  }

  const AddBtn = ({ path, source }: { path: string; source: string }) => (
    <button
      className="text-primary/70 hover:text-primary text-[11px]"
      title={active ? `Add to list "${active.name}"` : "Select an active list in Custom lists below"}
      onClick={() => addPaths.mutate({ paths: [path], source })}
    >
      +list
    </button>
  );

  const PathCell = ({ path, owner }: { path: string; owner?: string }) => (
    <button className="font-mono text-left hover:underline truncate max-w-[440px] block"
            title={`${path} — click for file detail`}
            onClick={() => drillToFiles(path, owner)}>
      {path.slice(root.length) || "/"}
    </button>
  );

  const ageSort = useSorted(age.data?.rows, "bytes");
  const dirSort = useSorted(dirs.data?.rows, "files");
  const ownerSort = useSorted(owners.data?.rows, "bytes");
  const largeSort = useSorted(largest.data?.rows, "bytes");
  const fileSort = useSorted(files.data?.rows, "bytes");

  const anyLoading = [age, dirs, owners, largest, files].some(q => q.isFetching);

  return (
    <div className="border border-border/60 rounded-md">
      <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
        <span className="text-xs font-medium mr-2">Reconnaissance</span>
        {([["age", "Age"], ["dirs", "Directories"], ["owners", "Owners"],
           ["largest", "Largest files"], ["files", "Path detail"]] as [Tab, string][]).map(([t, l]) => (
          <button key={t}
                  className={cn("px-2.5 h-7 text-xs rounded-t border-b-2 transition-colors",
                    tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
                  onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
        {anyLoading && <span className="text-[10px] text-muted-foreground ml-2">loading…</span>}
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">{root}</span>
      </div>

      <div className="p-3 border-t border-border/40 space-y-2">
        {tab === "age" && (
          <>
            {/* The measurement caveat lives IN the interface, not in docs */}
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
                        onClick={() => setMinAgeDays(d)}>
                  {d >= 365 ? `${d / 365} y` : `${d} d`}
                </button>
              ))}
            </div>
            {(age.data?.hidden_dismissed ?? 0) > 0 && !showDismissed && (
              <button className="text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => setShowDismissed(true)}>
                {age.data.hidden_dismissed} dismissed tree(s) hidden — show them
              </button>
            )}
            {showDismissed && (
              <button className="text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => setShowDismissed(false)}>
                hide dismissed
              </button>
            )}
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                <th className="w-6"></th>
                <th className="px-2 py-1.5">Cold subtree (whole tree unmodified)</th>
                {ageSort.TH({ k: "bytes", label: "Would free", right: true })}
                {ageSort.TH({ k: "files", label: "Files", right: true })}
                {ageSort.TH({ k: "last_modified", label: "Last modified", right: true })}
                <th className="w-24"></th>
              </tr></thead>
              <tbody>
                {ageSort.sorted.map((r: any) => (
                  <>
                    <tr key={r.path}
                        className={cn("border-b border-border/20 hover:bg-muted/20",
                          r.dismissed && "opacity-50")}>
                      <td className="px-1 py-1">
                        <button className="text-muted-foreground hover:text-foreground"
                                title="Preview: samples, extensions, owners, dates"
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
                      <td className="px-2 py-1 text-right font-mono" title={fmtDate(r.last_modified)}>
                        {fmtAge(r.last_modified)} ago
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {!r.dismissed && (
                          <button className="text-muted-foreground hover:text-foreground text-[11px] mr-2"
                                  title="Reviewed — dismiss with a note"
                                  onClick={() => dismissPath(r.path)}>
                            dismiss
                          </button>
                        )}
                        <AddBtn path={r.path} source={`recon:age>${minAgeDays}d`} />
                      </td>
                    </tr>
                    {expanded === r.path && (
                      <tr key={r.path + ":preview"}>
                        <td colSpan={6} className="border-b border-border/30">
                          <PreviewBox path={r.path} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tab === "dirs" && (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border/40">
              <th className="px-2 py-1.5">Directory</th>
              {dirSort.TH({ k: "files", label: "Files (recursive)", right: true })}
              {dirSort.TH({ k: "direct_files", label: "Files (direct)", right: true })}
              {dirSort.TH({ k: "bytes", label: "Bytes", right: true })}
              {dirSort.TH({ k: "last_modified", label: "Last mod", right: true })}
              <th className="w-10"></th>
            </tr></thead>
            <tbody>
              {dirSort.sorted.map((r: any) => (
                <>
                  <tr key={r.path} className={cn("border-b border-border/20 hover:bg-muted/20",
                        r.dismissed && "opacity-50")}>
                    <td className="px-2 py-1">
                      <button className="text-muted-foreground hover:text-foreground mr-1"
                              onClick={() => setExpanded(expanded === r.path ? null : r.path)}>
                        {expanded === r.path ? "▾" : "▸"}
                      </button>
                      <span className="inline-block align-middle"><PathCell path={r.path} /></span>
                      {r.dismissed && (
                        <div className="text-[10px] text-muted-foreground italic">
                          dismissed: {r.dismissed.note}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">{r.files.toLocaleString()}</td>
                    <td className="px-2 py-1 text-right font-mono">{r.direct_files.toLocaleString()}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmtAge(r.last_modified)}</td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {!r.dismissed && (
                        <button className="text-muted-foreground hover:text-foreground text-[11px] mr-2"
                                onClick={() => dismissPath(r.path)}>dismiss</button>
                      )}
                      <AddBtn path={r.path} source="recon:dirs" />
                    </td>
                  </tr>
                  {expanded === r.path && (
                    <tr key={r.path + ":preview"}>
                      <td colSpan={6} className="border-b border-border/30"><PreviewBox path={r.path} /></td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}

        {tab === "owners" && (
          <div className="grid gap-3 md:grid-cols-2">
            <table className="w-full text-xs self-start">
              <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                <th className="px-2 py-1.5">Owner</th>
                {ownerSort.TH({ k: "bytes", label: "Bytes", right: true })}
                {ownerSort.TH({ k: "files", label: "Files", right: true })}
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
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              {ownerDrill ? (
                <>
                  <div className="text-xs font-medium mb-1">{ownerDrill} — biggest directories</div>
                  <table className="w-full text-xs">
                    <tbody>
                      {(ownerDirs.data?.rows ?? []).map((r: any) => (
                        <tr key={r.path} className="border-b border-border/20 hover:bg-muted/20">
                          <td className="px-2 py-1"><PathCell path={r.path} owner={ownerDrill} /></td>
                          <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                          <td className="px-2 py-1 text-right font-mono">{r.files.toLocaleString()}</td>
                          <td className="px-2 py-1"><AddBtn path={r.path} source={`recon:owner:${ownerDrill}`} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <div className="text-xs text-muted-foreground pt-6 text-center">
                  Click an owner to see their biggest directories.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "largest" && (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border/40">
              <th className="px-2 py-1.5">File</th>
              {largeSort.TH({ k: "bytes", label: "Size", right: true })}
              <th className="px-2 py-1.5">Owner</th>
              {largeSort.TH({ k: "last_modified", label: "Last mod", right: true })}
              <th className="w-10"></th>
            </tr></thead>
            <tbody>
              {largeSort.sorted.map((r: any) => (
                <tr key={r.path} className="border-b border-border/20 hover:bg-muted/20">
                  <td className="px-2 py-1 font-mono truncate max-w-[460px]" title={r.path}>
                    {r.path.slice(root.length)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                  <td className="px-2 py-1 font-mono">{r.owner}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtAge(r.last_modified)}</td>
                  <td className="px-2 py-1"><AddBtn path={r.path} source="recon:largest" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "files" && (
          drill ? (
            <>
              <div className="text-xs text-muted-foreground font-mono">
                {drill.prefix}{drill.owner ? ` — owner ${drill.owner}` : ""}
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground border-b border-border/40">
                  <th className="px-2 py-1.5">File</th>
                  {fileSort.TH({ k: "bytes", label: "Size", right: true })}
                  <th className="px-2 py-1.5">Owner</th>
                  {fileSort.TH({ k: "last_modified", label: "Modified", right: true })}
                  {fileSort.TH({ k: "created", label: "Created", right: true })}
                  <th className="w-10"></th>
                </tr></thead>
                <tbody>
                  {fileSort.sorted.map((r: any) => (
                    <tr key={r.path} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="px-2 py-1 font-mono truncate max-w-[400px]" title={r.path}>
                        {r.path.slice(drill.prefix.length) || r.path.slice(root.length)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{formatBytes(r.bytes)}</td>
                      <td className="px-2 py-1 font-mono">{r.owner}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmtDate(r.last_modified)}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmtDate(r.created)}</td>
                      <td className="px-2 py-1"><AddBtn path={r.path} source="recon:files" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="text-xs text-muted-foreground py-4 text-center">
              Drill in from any other tab — click a directory or an owner's directory.
            </div>
          )
        )}
      </div>

      {/* -------- custom lists -------- */}
      <div className="px-3 py-2 border-t border-border/40 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">Custom lists</span>
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
          <button className="h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground"
                  onClick={async () => {
                    const name = window.prompt("New list name:");
                    if (!name) return;
                    try {
                      const d = await rapi("/lists", {
                        method: "POST", body: JSON.stringify({ name, root }),
                      }, currentUser);
                      setActive({ id: d.id, name }); setActiveList({ id: d.id, name });
                      qc.invalidateQueries({ queryKey: ["hk-lists"] });
                    } catch (e: any) { window.alert(e.message); }
                  }}>
            + New list
          </button>
          {active && (
            <button className="h-7 px-2 rounded border border-primary text-primary"
                    onClick={async () => {
                      if (!window.confirm(`Convert "${active.name}" into worklist targets?`)) return;
                      try {
                        const d = await rapi(`/lists/${active.id}/to-worklist`, { method: "POST" }, currentUser);
                        window.alert(`${d.created.length} target(s) created under campaign "${d.campaign}".`);
                        qc.invalidateQueries({ queryKey: ["hk-report"] });
                      } catch (e: any) { window.alert(e.message); }
                    }}>
              Convert to worklist
            </button>
          )}
          <span className="text-muted-foreground">
            The active list receives "+list" clicks here, in the Tree Explorer and in the Treemap.
          </span>
        </div>
        {active && (listItems.data?.length ?? 0) > 0 && (
          <table className="w-full text-xs">
            <tbody>
              {listItems.data!.map((it: any) => (
                <tr key={it.path_hash} className="border-b border-border/20">
                  <td className="px-2 py-1 font-mono truncate max-w-[420px]" title={it.path}>{it.path}</td>
                  <td className="px-2 py-1 text-muted-foreground">{it.kind}</td>
                  <td className="px-2 py-1 text-right font-mono">{formatBytes(it.bytes)}</td>
                  <td className="px-2 py-1 text-right font-mono">{it.files.toLocaleString()}</td>
                  <td className="px-2 py-1 text-muted-foreground">{it.source}</td>
                  <td className="px-2 py-1">
                    <button className="text-red-500/70 hover:text-red-500"
                            title="Remove from list"
                            onClick={async () => {
                              await rapi(`/lists/${active.id}/items/${it.path_hash}`, { method: "DELETE" }, currentUser);
                              qc.invalidateQueries({ queryKey: ["hk-lists"] });
                              qc.invalidateQueries({ queryKey: ["hk-list-items"] });
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
