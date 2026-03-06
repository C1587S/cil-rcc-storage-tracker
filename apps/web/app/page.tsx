"use client";

import { SnapshotSelector } from "@/components/snapshot-selector";
import { DiskUsageExplorerV2 } from "@/components/disk-usage-explorer-v2";
import { HierarchicalVoronoiView } from "@/components/hierarchical-voronoi-view";
import { SearchConsole } from "@/components/search-console";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";

const TABS = [
  { id: "query",   label: "Query Console" },
  { id: "tree",    label: "Tree Explorer" },
  { id: "voronoi", label: "Voronoi"       },
] as const;

type TabId = typeof TABS[number]["id"];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("query");
  const isVoronoiFullscreen = useAppStore(state => state.isVoronoiFullscreen);

  const containerClass = "max-w-6xl mx-auto px-6";

  return (
    <main className={cn("min-h-screen", isVoronoiFullscreen ? "p-0" : "pb-8")}>

      {!isVoronoiFullscreen && (
        <>
          {/* Top navbar — logo + theme toggle */}
          <nav className="border-b border-border bg-card sticky top-0 z-40">
            <div className={cn(containerClass, "py-4")}>
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight">
                  <span style={{ color: '#8B1538' }}>C</span>
                  <span className="text-muted-foreground">I</span>
                  <span style={{ color: '#4169E1' }}>L</span>
                  <span className="text-muted-foreground">-RCC-TRACKER</span>
                </h1>
                <ThemeToggle />
              </div>
            </div>
          </nav>

          {/* Secondary nav — tab selector */}
          <div className="border-b border-border bg-card sticky top-[73px] z-30">
            <div className={containerClass}>
              <nav className="flex gap-0" aria-label="Main navigation">
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "relative px-5 py-3 text-sm font-medium tracking-wide transition-colors",
                      "focus:outline-none",
                      activeTab === tab.id
                        ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-primary"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Snapshot selector */}
          <div className={cn(containerClass, "mt-0")}>
            <SnapshotSelector />
          </div>
        </>
      )}

      {/* Tab content */}
      <div className="relative mt-6">
        <div className={cn("space-y-6", containerClass, activeTab !== "query" && "hidden")}>
          <SearchConsole />
        </div>

        <div className={cn("space-y-6", containerClass, activeTab !== "tree" && "hidden")}>
          <DiskUsageExplorerV2 />
        </div>

        <div className={cn("w-full", activeTab !== "voronoi" && "hidden", !isVoronoiFullscreen && containerClass)}>
          <HierarchicalVoronoiView />
        </div>
      </div>

    </main>
  );
}