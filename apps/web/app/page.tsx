"use client";

import { SnapshotSelector } from "@/components/snapshot-selector";
import { DiskUsageExplorerV2 } from "@/components/disk-usage-explorer-v2";
import { HierarchicalVoronoiView } from "@/components/hierarchical-voronoi-view";
import { SearchConsole } from "@/components/search-console";
import { DocsPage } from "@/components/docs-page";
import { ComputingDashboard } from "@/components/computing-dashboard";
import { ProjectionsDashboard } from "@/components/projections-dashboard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LoginGate, LogoutButton } from "@/components/login-gate";
import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";

const TAB_GROUPS = [
  {
    tabs: [{ id: "docs", label: "Docs" }] as const,
  },
  {
    label: "Computing",
    color: "#5e81ac",
    tabs: [
      { id: "computing", label: "Computing" },
      // { id: "projections", label: "Projections" },
    ] as const,
  },
  {
    label: "Storage",
    color: "#8fbcbb",
    tabs: [
      { id: "query",   label: "Query Console" },
      { id: "tree",    label: "Tree Explorer" },
      { id: "voronoi", label: "Voronoi"       },
    ] as const,
  },
] as const;

type TabId = typeof TAB_GROUPS[number]["tabs"][number]["id"];

const ALL_TAB_IDS = TAB_GROUPS.flatMap(g => g.tabs.map(t => t.id)) as TabId[];
const DEFAULT_TAB: TabId = "docs";

function getTabFromHash(): TabId {
  if (typeof window === "undefined") return DEFAULT_TAB;
  const hash = window.location.hash.replace("#", "");
  return ALL_TAB_IDS.includes(hash as TabId) ? (hash as TabId) : DEFAULT_TAB;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_TAB);

  // Sync tab from hash on mount and hash changes
  useEffect(() => {
    setActiveTab(getTabFromHash());
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Update hash when tab changes
  const changeTab = useCallback((tab: TabId) => {
    setActiveTab(tab);
    window.history.replaceState(null, "", `#${tab}`);
  }, []);
  const isVoronoiFullscreen = useAppStore(state => state.isVoronoiFullscreen);
  const [logoSpinning, setLogoSpinning] = useState(false);
  const logoRef = useRef<HTMLImageElement>(null);

  const containerClass = "max-w-[1440px] mx-auto px-4 sm:px-8";

  return (
    <LoginGate>
    <main className={cn("min-h-screen", isVoronoiFullscreen ? "p-0" : "pb-8")}>

      {!isVoronoiFullscreen && (
        <>
          {/* Top navbar — logo + theme toggle */}
          <nav className="border-b border-border bg-card sticky top-0 z-40">
            <div className={cn(containerClass, "py-3 sm:py-4")}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 sm:gap-3">
                  <img
                    ref={logoRef}
                    src="/cil-rcc-tracker/cil_rcc_console.png"
                    alt="CRC"
                    width={28}
                    height={28}
                    className={cn("rounded-full w-6 h-6 sm:w-7 sm:h-7 logo-spin", logoSpinning && "spinning")}
                    onMouseEnter={() => setLogoSpinning(true)}
                    onAnimationEnd={() => setLogoSpinning(false)}
                  />
                  <h1 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
                    CIL RCC <span className="font-normal text-muted-foreground">Console</span>
                  </h1>
                </div>
                <div className="flex items-center gap-2 sm:gap-4">
                  <LogoutButton />
                  <ThemeToggle />
                </div>
              </div>
            </div>
          </nav>

          {/* Secondary nav — tab selector */}
          <div className="border-b border-border bg-card sticky top-[57px] sm:top-[73px] z-30">
            <div className={containerClass}>
              <nav className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide" aria-label="Main navigation">
                {TAB_GROUPS.map((group, gi) => {
                  const hasBox = "color" in group && group.color;
                  const groupActive = group.tabs.some(t => t.id === activeTab);
                  return (
                    <div
                      key={gi}
                      className={cn(
                        "flex items-center gap-0 rounded-md transition-colors",
                        hasBox && "px-1 py-0.5"
                      )}
                      style={hasBox ? {
                        background: `${group.color}${groupActive ? "20" : "10"}`,
                        border: `1px solid ${group.color}${groupActive ? "60" : "35"}`,
                      } : undefined}
                    >
                      {group.tabs.map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => changeTab(tab.id)}
                          className={cn(
                            "relative px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium tracking-wide transition-colors rounded whitespace-nowrap",
                            "focus:outline-none",
                            activeTab === tab.id
                              ? "text-foreground after:absolute after:bottom-0 after:left-1 after:right-1 after:h-[2px] after:bg-primary after:rounded-full"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  );
                })}
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

        <div className={cn("space-y-6", containerClass, activeTab !== "projections" && "hidden")}>
          <ProjectionsDashboard />
        </div>

        <div className={cn("space-y-6", containerClass, activeTab !== "docs" && "hidden")}>
          <DocsPage onNavigateToTab={(tabId) => changeTab(tabId as TabId)} />
        </div>
      </div>

    </main>
    </LoginGate>
  );
}