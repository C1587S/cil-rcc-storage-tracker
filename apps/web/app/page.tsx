"use client";

import { SnapshotSelector } from "@/components/snapshot-selector";
import { DiskUsageExplorerV2 } from "@/components/disk-usage-explorer-v2";
import { HierarchicalVoronoiView } from "@/components/hierarchical-voronoi-view";
import { SearchConsole } from "@/components/search-console";
import { DocsPage } from "@/components/docs-page";
import { ComputingDashboard } from "@/components/computing-dashboard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoginGate, LogoutButton } from "@/components/login-gate";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";

const TABS = [
  { id: "docs",      label: "Docs"         },
  { id: "query",   label: "Query Console" },
  { id: "tree",    label: "Tree Explorer" },
  { id: "voronoi",   label: "Voronoi"       },
  { id: "computing", label: "Computing"    },
] as const;

type TabId = typeof TABS[number]["id"];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>("docs");
  const isVoronoiFullscreen = useAppStore(state => state.isVoronoiFullscreen);

  const containerClass = "max-w-[1440px] mx-auto px-8";

  return (
    <LoginGate>
    <main className={cn("min-h-screen", isVoronoiFullscreen ? "p-0" : "pb-8")}>

      {!isVoronoiFullscreen && (
        <>
          {/* Top navbar — logo + theme toggle */}
          <nav className="border-b border-border bg-card sticky top-0 z-40">
            <div className={cn(containerClass, "py-4")}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img
                    src="/cil-rcc-tracker/cil_rcc_console.png"
                    alt="CRC"
                    width={28}
                    height={28}
                    className="rounded-full"
                  />
                  <h1 className="text-lg font-semibold tracking-tight text-foreground">
                    CIL RCC <span className="font-normal text-muted-foreground">Console</span>
                  </h1>
                </div>
                <div className="flex items-center gap-4">
                  <LogoutButton />
                  <ThemeToggle />
                </div>
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

        <div className={cn("space-y-6", containerClass, activeTab !== "computing" && "hidden")}>
          <ComputingDashboard />
        </div>

        <div className={cn("space-y-6", containerClass, activeTab !== "docs" && "hidden")}>
          <DocsPage onNavigateToTab={(tabId) => setActiveTab(tabId as TabId)} />
        </div>
      </div>

    </main>
    </LoginGate>
  );
}