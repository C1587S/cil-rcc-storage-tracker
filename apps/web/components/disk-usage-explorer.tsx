"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowse } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, Folder, Maximize2, Minimize2 } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface FolderTreeNodeProps {
  path: string;
  name: string;
  snapshotDate: string;
  level: number;
  size: number;
  sizeFormatted: string;
  fileCount?: number;
  owner?: string;
  modifiedTime?: number;
  parentSize?: number;
  rootSize?: number;
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function DuTreeNode({
  path,
  name,
  snapshotDate,
  level,
  size,
  sizeFormatted,
  fileCount,
  owner,
  modifiedTime,
  parentSize,
  rootSize,
}: FolderTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { setSelectedPath } = useAppStore();

  const { data, isLoading } = useQuery({
    queryKey: ["browse", snapshotDate, path],
    queryFn: () => getBrowse({ snapshot_date: snapshotDate, parent_path: path }),
    enabled: isExpanded,
  });

  const hasChildren = data && data.folders.length > 0;

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
    setSelectedPath(path);
  };

  // Calculate percentages
  const parentPercent = parentSize ? (size / parentSize) * 100 : 100;
  const rootPercent = rootSize ? (size / rootSize) * 100 : 0;

  // Color based on size
  const getBarColor = (percent: number) => {
    if (percent > 50) return "bg-red-500/70";
    if (percent > 20) return "bg-yellow-500/70";
    if (percent > 5) return "bg-blue-500/70";
    return "bg-muted/70";
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1.5 hover:bg-accent/50 cursor-pointer group",
          "border-l-2 border-transparent hover:border-primary/30 transition-colors"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleToggle}
      >
        {/* Chevron and folder icon */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ChevronRight
            className={cn(
              "w-3.5 h-3.5 text-muted-foreground transition-transform",
              isExpanded && "rotate-90"
            )}
          />
          <Folder className="w-3.5 h-3.5 text-primary/80" />
        </div>

        {/* Name */}
        <span className="text-xs font-medium truncate min-w-[120px] max-w-[200px]">
          {name}
        </span>

        {/* Dutree-style size bar */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <div className="flex-1 h-4 bg-muted/30 rounded-sm overflow-hidden min-w-[100px]">
            <div
              className={cn("h-full transition-all", getBarColor(parentPercent))}
              style={{ width: `${Math.max(parentPercent, 2)}%` }}
            />
          </div>

          {/* Size and percentage */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-mono text-muted-foreground min-w-[60px] text-right">
              {sizeFormatted}
            </span>
            <span className="text-xs font-mono text-muted-foreground/70 min-w-[45px] text-right">
              {parentPercent.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Metadata (shown on hover) */}
        <div className="hidden group-hover:flex items-center gap-3 text-xs text-muted-foreground/60 flex-shrink-0 ml-2">
          {fileCount !== undefined && fileCount > 0 && (
            <span className="font-mono">{fileCount} files</span>
          )}
          {modifiedTime && (
            <span className="font-mono">{formatDate(modifiedTime)}</span>
          )}
          {owner && <span className="truncate max-w-[80px]">{owner}</span>}
        </div>

        {/* Root percentage (subtle, right-aligned) */}
        {rootSize && rootPercent > 0 && (
          <span className="hidden xl:block text-xs font-mono text-muted-foreground/40 ml-2 min-w-[50px] text-right">
            {rootPercent.toFixed(2)}%
          </span>
        )}
      </div>

      {/* Children */}
      {isExpanded && (
        <div>
          {isLoading && (
            <div
              className="text-xs text-muted-foreground px-2 py-1"
              style={{ paddingLeft: `${(level + 1) * 12 + 24}px` }}
            >
              Loading...
            </div>
          )}
          {hasChildren &&
            data.folders.map((folder) => (
              <DuTreeNode
                key={folder.path}
                path={folder.path}
                name={folder.name}
                snapshotDate={snapshotDate}
                level={level + 1}
                size={folder.size}
                sizeFormatted={folder.size_formatted || ""}
                fileCount={folder.file_count}
                owner={folder.owner}
                modifiedTime={folder.modified_time}
                parentSize={size}
                rootSize={rootSize}
              />
            ))}
          {isExpanded && !isLoading && !hasChildren && (
            <div
              className="text-xs text-muted-foreground/50 px-2 py-1 italic"
              style={{ paddingLeft: `${(level + 1) * 12 + 24}px` }}
            >
              No subfolders
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DiskUsageExplorer() {
  const { selectedSnapshot } = useAppStore();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rootSize, setRootSize] = useState<number | undefined>(undefined);

  // Fetch root size for percentage calculations
  const { data: rootData } = useQuery({
    queryKey: ["browse", selectedSnapshot, "/project/cil"],
    queryFn: () =>
      getBrowse({ snapshot_date: selectedSnapshot!, parent_path: "/project/cil" }),
    enabled: !!selectedSnapshot,
  });

  // Calculate total root size from children
  useEffect(() => {
    if (rootData?.folders) {
      const total = rootData.folders.reduce((sum, f) => sum + f.size, 0);
      setRootSize(total);
    }
  }, [rootData]);

  // ESC key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isFullscreen]);

  if (!selectedSnapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Disk Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">
            Select a snapshot to explore disk usage
          </div>
        </CardContent>
      </Card>
    );
  }

  const content = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold">Disk Usage Explorer</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {selectedSnapshot} · dutree-style visualization
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isFullscreen && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(true)}
              className="gap-1.5"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Fullscreen
            </Button>
          )}
          {isFullscreen && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(false)}
              className="gap-1.5"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              Exit
            </Button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3 pb-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-500/70 rounded-sm" />
          <span>&gt;50%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-yellow-500/70 rounded-sm" />
          <span>&gt;20%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-blue-500/70 rounded-sm" />
          <span>&gt;5%</span>
        </div>
        <span className="ml-auto">
          Bars show % of parent · Hover for metadata
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <DuTreeNode
          path="/project/cil"
          name="/project/cil"
          snapshotDate={selectedSnapshot}
          level={0}
          size={rootSize || 0}
          sizeFormatted={rootData?.folders
            ? `${(rootSize! / 1024 / 1024 / 1024).toFixed(2)} GiB`
            : "..."}
          rootSize={rootSize}
        />
      </div>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <div className="h-full p-6">{content}</div>
      </div>
    );
  }

  return (
    <Card className="h-[700px]">
      <CardContent className="h-full p-6">{content}</CardContent>
    </Card>
  );
}
