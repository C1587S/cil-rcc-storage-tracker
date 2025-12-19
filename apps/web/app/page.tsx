"use client";

import { SnapshotSelector } from "@/components/snapshot-selector";
import { DiskUsageExplorer } from "@/components/disk-usage-explorer";

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">CIL-rcc-tracker</h1>
          <p className="text-muted-foreground">Filesystem snapshot explorer</p>
        </header>

        <div className="mb-6">
          <SnapshotSelector />
        </div>

        <DiskUsageExplorer />
      </div>
    </main>
  );
}
