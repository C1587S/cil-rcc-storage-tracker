"use client";

import { SnapshotSelector } from "@/components/snapshot-selector";
import { FolderExplorer } from "@/components/folder-explorer";

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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FolderExplorer />
        </div>
      </div>
    </main>
  );
}
