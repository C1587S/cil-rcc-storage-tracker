"use client";

import Image from "next/image";
import { SnapshotSelector } from "@/components/snapshot-selector";
import { DiskUsageExplorerV2 } from "@/components/disk-usage-explorer-v2";
import { HierarchicalVoronoiView } from "@/components/hierarchical-voronoi-view";
import { SearchConsole } from "@/components/search-console";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";

export default function Home() {
  const [activeTab, setActiveTab] = useState("tree");

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
  };

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">

          {/* Título + Logo juntos */}
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-primary">
              CIL-rcc-tracker
            </h1>

            {/* LOGO reflejado */}
            <Image
              src="/logo_tracker.png"
              alt="Tracker Logo"
              width={55}
              height={55}
              className="object-contain"
              style={{ transform: "scaleX(-1)" }}
            />
          </div>

          <p className="text-muted-foreground">
            Filesystem snapshot explorer
          </p>

          <div className="mt-2 p-2 bg-green-900/20 border border-green-600 rounded text-sm text-green-400">
            Precomputed voronoi data
          </div>
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
            {/* Keep both tabs mounted but toggle visibility to preserve state */}
            <div className={`space-y-6 ${activeTab !== "tree" ? "hidden" : ""}`}>
              <DiskUsageExplorerV2 />
              <SearchConsole />
            </div>

            <div className={`space-y-6 ${activeTab !== "voronoi" ? "hidden" : ""}`}>
              <HierarchicalVoronoiView />
            </div>
          </div>
        </Tabs>
      </div>
    </main>
  );
}
