"use client";

import { SnapshotSelector } from "@/components/snapshot-selector";
import { DiskUsageExplorerV2 } from "@/components/disk-usage-explorer-v2";
import { HierarchicalVoronoiView } from "@/components/hierarchical-voronoi-view";
import { SearchConsole } from "@/components/search-console";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

        <Tabs defaultValue="tree" className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-[400px] mb-6">
            <TabsTrigger value="tree">Tree View</TabsTrigger>
            <TabsTrigger value="voronoi">Voronoi View</TabsTrigger>
          </TabsList>

          <TabsContent value="tree" className="space-y-6">
            <DiskUsageExplorerV2 />
            <SearchConsole />
          </TabsContent>

          <TabsContent value="voronoi" className="space-y-6">
            <HierarchicalVoronoiView />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
