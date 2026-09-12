"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshots, API_BASE_URL } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Select } from "@/components/ui/select";

const formatTimestamp = (ts?: string) => {
  if (!ts) return null;
  const utc = ts.endsWith("Z") || ts.includes("+") ? ts : ts + "Z";
  const d = new Date(utc);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

/** Freshness badge for the scan date: green when recent, amber when aging,
 *  red when the pipeline is likely broken. Staleness must be visible. */
function scanAgeBadge(snapshotDate: string) {
  const ageDays = Math.floor((Date.now() - new Date(snapshotDate + "T00:00:00").getTime()) / 86400000);
  const label = ageDays <= 0 ? "today" : ageDays === 1 ? "1 day ago" : `${ageDays} days ago`;
  const tone =
    ageDays <= 2 ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : ageDays <= 7 ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
    : "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400";
  return { label, tone, ageDays };
}


// Storage roots the dashboard can explore. cds3 appears once its scan data
// is imported; selecting it before that shows an empty tree.
const STORAGE_ROOTS = [
  { path: "/project/cil", label: "/project/cil (Capacity)" },
  { path: "/cds3/cil", label: "/cds3/cil (Cost-Effective)" },
];

export function SnapshotSelector() {
  const { selectedSnapshot, setSelectedSnapshot, referencePath, setReferencePath, setReferenceSize } = useAppStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ["snapshots"],
    queryFn: getSnapshots,
  });

  // Which roots actually have data in this snapshot (cds3 stays disabled
  // until its scan is imported)
  const { data: rootAvailability } = useQuery({
    queryKey: ["root-availability", selectedSnapshot],
    enabled: !!selectedSnapshot,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const out: Record<string, boolean> = {};
      await Promise.all(STORAGE_ROOTS.map(async r => {
        try {
          const res = await fetch(
            `${API_BASE_URL}/api/contents?snapshot_date=${selectedSnapshot}&parent_path=${encodeURIComponent(r.path)}&limit=1`
          );
          const j = await res.json();
          out[r.path] = (j.entries?.length ?? 0) > 0;
        } catch {
          out[r.path] = true; // fail open: don't disable on a transient error
        }
      }));
      return out;
    },
  });

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedSnapshot(e.target.value || null);
  };

  const snapshots = data || [];

  // Auto-select the latest snapshot on load
  useEffect(() => {
    if (!selectedSnapshot && snapshots.length > 0) {
      setSelectedSnapshot(snapshots[0].snapshot_date);
    }
  }, [snapshots, selectedSnapshot, setSelectedSnapshot]);

  const selectedSnapshot_ = snapshots.find((s) => s.snapshot_date === selectedSnapshot);

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-4 py-3 border-b border-border/50">
      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
        Snapshot
      </span>

      {isLoading ? (
        <span className="text-xs text-muted-foreground/60">Loading…</span>
      ) : error ? (
        <span className="text-xs text-destructive">Failed to load snapshots</span>
      ) : (
        <div className="relative inline-flex items-center">
          <Select
            id="snapshot-select"
            value={selectedSnapshot || ""}
            onChange={handleChange}
            className="h-8 text-xs max-w-[220px] border-border/60 bg-transparent pr-8"
          >
            {snapshots.map((snapshot) => (
              <option key={snapshot.snapshot_date} value={snapshot.snapshot_date}>
                {snapshot.snapshot_date}
              </option>
            ))}
          </Select>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-xs pointer-events-none font-mono">…</span>
        </div>
      )}

      {selectedSnapshot && (() => {
        const b = scanAgeBadge(selectedSnapshot);
        const valueBg =
          b.ageDays <= 2 ? "#2ea44f" : b.ageDays <= 7 ? "#d29922" : "#cf222e";
        return (
          <span
            className="inline-flex items-stretch text-[11px] font-semibold rounded-full overflow-hidden shadow-sm select-none"
            title={
              b.ageDays > 7
                ? "Scan data is stale: the RCC scan pipeline may be down"
                : "Date of the filesystem scan this data comes from"
            }
          >
            <span className="px-2.5 py-0.5 bg-[#444d56] text-white flex items-center">
              scan
            </span>
            <span className="px-2.5 py-0.5 text-white flex items-center" style={{ background: valueBg }}>
              {selectedSnapshot} · {b.label}
            </span>
          </span>
        );
      })()}

      {/* Storage-root switch: single-select button group, applies on click */}
      <span className="inline-flex items-stretch text-[11px] font-semibold rounded-full overflow-hidden shadow-sm select-none">
        <span className="px-2.5 py-0.5 bg-[#444d56] text-white flex items-center">root</span>
        {STORAGE_ROOTS.map(r => {
          const available = rootAvailability?.[r.path] !== false;
          const isActive = (referencePath || "/project/cil") === r.path;
          return (
            <button
              key={r.path}
              disabled={!available}
              className="px-2.5 py-0.5 flex items-center gap-1 transition-colors disabled:cursor-not-allowed"
              style={{
                background: isActive ? "#1f6feb" : "#2d333b",
                color: isActive ? "#ffffff" : "#8b949e",
                fontWeight: isActive ? 700 : 500,
                opacity: available ? 1 : 0.45,
                textDecoration: available ? "none" : "line-through",
              }}
              title={
                !available
                  ? `${r.label}: no scan data imported yet`
                  : isActive
                    ? `${r.label} (active)`
                    : `Switch Tree, Voronoi and Treemap to ${r.label}`
              }
              onClick={() => {
                if (!isActive) {
                  setReferencePath(r.path);
                  setReferenceSize(0);
                }
              }}
            >
              {isActive ? "●" : "○"} {r.path.split("/")[1]}
            </button>
          );
        })}
      </span>

      {selectedSnapshot_?.import_time && (
        <span className="text-xs text-muted-foreground/60 ml-1">
          DB updated {formatTimestamp(selectedSnapshot_.import_time)}
        </span>
      )}

      {!selectedSnapshot && !isLoading && !error && snapshots.length === 0 && (
        <span className="text-xs text-muted-foreground/35 font-mono ml-2 flex-shrink-0">
          no snapshots available
        </span>
      )}
    </div>
  );
}
