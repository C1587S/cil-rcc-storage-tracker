"use client";

import { SnapshotSelector } from "@/components/snapshot-selector";
import { DiskUsageExplorerV2 } from "@/components/disk-usage-explorer-v2";
import { HierarchicalVoronoiView } from "@/components/hierarchical-voronoi-view";
import { SearchConsole } from "@/components/search-console";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";

export default function Home() {
  const [activeTab, setActiveTab] = useState("tree");
  const isVoronoiFullscreen = useAppStore(
    state => state.isVoronoiFullscreen
  );

  const containerClass = "max-w-7xl mx-auto px-8";

  return (
    <main className={cn("min-h-screen", isVoronoiFullscreen ? "p-0" : "pb-8")}>
      {!isVoronoiFullscreen && (
        <nav className="border-b border-border bg-card sticky top-0 z-40">
          <div className={cn(containerClass, "py-4")}>
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold tracking-tight text-gray-600 dark:text-gray-300">
                CIL-RCC-TRACKER
              </h1>
              <ThemeToggle />
            </div>
          </div>
        </nav>
      )}

      {!isVoronoiFullscreen && (
        <div className={cn(containerClass, "mt-6 mb-6")}>
          <SnapshotSelector />
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        {!isVoronoiFullscreen && (
          <div className={containerClass}>
            <TabsList className="grid w-full grid-cols-2 max-w-[400px] mb-6">
              <TabsTrigger value="tree">Tree</TabsTrigger>
              <TabsTrigger value="voronoi">Voronoi</TabsTrigger>
            </TabsList>
          </div>
        )}

        <div className="relative">
          <div
            className={cn(
              "space-y-6",
              activeTab !== "tree" && "hidden",
              containerClass
            )}
          >
            <DiskUsageExplorerV2 />
            <SearchConsole />
          </div>

          <div
            className={cn(
              "w-full",
              activeTab !== "voronoi" && "hidden",
              !isVoronoiFullscreen && containerClass
            )}
          >
            <HierarchicalVoronoiView />
          </div>
        </div>
      </Tabs>
    </main>
  );
}
