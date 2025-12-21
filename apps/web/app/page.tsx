"use client";

import { SnapshotSelector } from "@/components/snapshot-selector";
import { DiskUsageExplorerV2 } from "@/components/disk-usage-explorer-v2";
import { HierarchicalVoronoiView } from "@/components/hierarchical-voronoi-view";
import { SearchConsole } from "@/components/search-console";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";

export default function Home() {
  const [activeTab, setActiveTab] = useState("tree");
  const [prevTab, setPrevTab] = useState("tree");

  const handleTabChange = (newTab: string) => {
    setPrevTab(activeTab);
    setActiveTab(newTab);
  };

  // Determine slide direction: tree (0) → voronoi (1) or vice versa
  const tabIndex = { tree: 0, voronoi: 1 };
  const slideDirection = tabIndex[activeTab as keyof typeof tabIndex] > tabIndex[prevTab as keyof typeof tabIndex] ? "left" : "right";

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

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-[400px] mb-6">
            <TabsTrigger value="tree">Tree</TabsTrigger>
            <TabsTrigger value="voronoi">Voronoi</TabsTrigger>
          </TabsList>

          <div className="relative">
            <TabsContent
              value="tree"
              className={`space-y-6 transition-all duration-300 ${
                activeTab === "tree"
                  ? slideDirection === "right"
                    ? "animate-slide-in-from-left"
                    : "animate-slide-in-from-right"
                  : "hidden"
              }`}
            >
              <DiskUsageExplorerV2 />
              <SearchConsole />
            </TabsContent>

            <TabsContent
              value="voronoi"
              className={`space-y-6 transition-all duration-300 ${
                activeTab === "voronoi"
                  ? slideDirection === "left"
                    ? "animate-slide-in-from-right"
                    : "animate-slide-in-from-left"
                  : "hidden"
              }`}
            >
              <HierarchicalVoronoiView />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </main>
  );
}
