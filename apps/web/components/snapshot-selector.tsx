"use client";

import { useQuery } from "@tanstack/react-query";
import { getSnapshots } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SnapshotSelector() {
  const { selectedSnapshot, setSelectedSnapshot } = useAppStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ["snapshots"],
    queryFn: getSnapshots,
  });

  // Debug logging
  console.log("SnapshotSelector - data:", data);
  console.log("SnapshotSelector - isLoading:", isLoading);
  console.log("SnapshotSelector - error:", error);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    console.log("Snapshot selected:", value);
    setSelectedSnapshot(value || null);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">Loading snapshots...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-destructive">
            Error loading snapshots: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  // data is now directly an array of Snapshot objects
  const snapshots = data || [];

  console.log("Snapshots to render:", snapshots);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Snapshot</CardTitle>
      </CardHeader>
      <CardContent>
        <Select value={selectedSnapshot || ""} onChange={handleChange}>
          <option value="">Select a snapshot...</option>
          {snapshots.map((snapshot) => (
            <option key={snapshot.snapshot_date} value={snapshot.snapshot_date}>
              {snapshot.snapshot_date} ({snapshot.total_entries.toLocaleString()}{" "}
              entries)
            </option>
          ))}
        </Select>
        {selectedSnapshot && (
          <div className="mt-2 text-xs text-muted-foreground">
            Selected: {selectedSnapshot}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
