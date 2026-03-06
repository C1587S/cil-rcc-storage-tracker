"use client";

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
  const selectedSnapshot_ = snapshots.find((s) => s.snapshot_date === selectedSnapshot);

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border/50">
      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
        Snapshot
      </span>

      {isLoading ? (
        <span className="text-xs text-muted-foreground/60">Loading…</span>
      ) : error ? (
        <span className="text-xs text-destructive">Failed to load snapshots</span>
      ) : (
        <Select
          id="snapshot-select"
          value={selectedSnapshot || ""}
          onChange={handleChange}
          className="h-8 text-xs max-w-[220px] border-border/60 bg-transparent"
        >
          <option value="">Select a snapshot…</option>
          {snapshots.map((snapshot) => (
            <option key={snapshot.snapshot_date} value={snapshot.snapshot_date}>
              {snapshot.snapshot_date}
            </option>
          ))}
        </Select>
      )}

      {selectedSnapshot_?.import_time && (
        <span className="text-xs text-muted-foreground/60 ml-1">
          DB updated {formatTimestamp(selectedSnapshot_.import_time)}
        </span>
      )}
    </div>
  );
}
