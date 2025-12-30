"use client";

import Image from "next/image";
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
  const isVoronoiFullscreen = useAppStore(state => state.isVoronoiFullscreen);

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
  };

  // Common class to keep content centered
  // Used for header, tabs and tree view, but NOT for Voronoi
  const containerClass = "max-w-7xl mx-auto px-8";

  return (
    <main className={cn("min-h-screen", isVoronoiFullscreen ? "p-0" : "pb-8")}>

      {/* Navbar - always visible except in fullscreen */}
      {!isVoronoiFullscreen && (
        <nav className="border-b border-border bg-card sticky top-0 z-40">
          <div className={cn(containerClass, "py-4")}>
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold tracking-tight">
                <span style={{ color: '#8B1538' }}>C</span>
                <span className="text-muted-foreground">I</span>
                <span style={{ color: '#4169E1' }}>L</span>
                <span className="text-muted-foreground">-</span>
                <span className="text-muted-foreground">RCC</span>
                <span className="text-muted-foreground">-</span>
                <span className="text-muted-foreground">TRACKER</span>
              </h1>
              <ThemeToggle />
            </div>
          </div>
        </nav>
      )}

      {/* Snapshot selector - hidden when Voronoi is in fullscreen */}
      {!isVoronoiFullscreen && (
        <div className={cn(containerClass, "mt-6 mb-6")}>
          <SnapshotSelector />
        </div>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">

        {/* Tabs list - hidden when Voronoi is in fullscreen */}
        {!isVoronoiFullscreen && (
          <div className={containerClass}>
            <TabsList className="grid w-full grid-cols-2 max-w-[400px] mb-6">
              <TabsTrigger value="tree">Tree</TabsTrigger>
              <TabsTrigger value="voronoi">Voronoi</TabsTrigger>
            </TabsList>
          </div>
        )}

        <div className="relative">
          {/* 3. VISTA TREE + SEARCH (Centrado con max-width consistente) */}
          <div
            className={`space-y-6 ${activeTab !== "tree" ? "hidden" : ""} ${containerClass}`}
          >
            <DiskUsageExplorerV2 />
            <SearchConsole />
          </div>

          {/* 4. VISTA VORONOI (Centrado con el mismo max-width para consistencia) */}
          {/* En modo fullscreen, el componente HierarchicalVoronoiView maneja su propio ancho.
              En modo normal, aplicamos el mismo containerClass que el Tree para consistencia visual.
          */}
          <div
            className={`w-full ${activeTab !== "voronoi" ? "hidden" : ""} ${!isVoronoiFullscreen ? containerClass : ""}`}
          >
            <HierarchicalVoronoiView />
          </div>
        </div>
      </Tabs>
    </main>
  );
}