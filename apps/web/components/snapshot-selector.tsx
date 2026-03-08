"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSnapshots } from "@/lib/api";
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

export function SnapshotSelector() {
  const { selectedSnapshot, setSelectedSnapshot } = useAppStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ["snapshots"],
    queryFn: getSnapshots,
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
