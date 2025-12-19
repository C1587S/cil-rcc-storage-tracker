"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowse } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Maximize2,
  Minimize2,
  Target,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

type ReferenceMode = "directory" | "project" | "custom";

interface DiskUsageState {
  referenceMode: ReferenceMode;
  customReferencePath: string | null;
  customReferenceSize: number | null;
}

interface TreeNodeProps {
  path: string;
  name: string;
  snapshotDate: string;
  level: number;
  isDirectory: boolean;
  size: number;  // Direct size
  sizeFormatted: string;
  recursiveSize?: number;  // Recursive subtree size (dirs only)
  recursiveSizeFormatted?: string;
  fileCount?: number;
  dirCount?: number;
  owner?: string;
  modifiedTime?: number;
  accessedTime?: number;
  fileType?: string;
  referenceSize: number;  // For percentage calculation
  state: DiskUsageState;
  onSetReference?: (path: string, size: number) => void;
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

function TreeNode({
  path,
  name,
  snapshotDate,
  level,
  isDirectory,
  size,
  sizeFormatted,
  recursiveSize,
  recursiveSizeFormatted,
  fileCount,
  dirCount,
  owner,
  modifiedTime,
  accessedTime,
  fileType,
  referenceSize,
  state,
  onSetReference,
}: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { setSelectedPath } = useAppStore();

  // Use browse endpoint for directory tree (recursive sizes)
  const { data, isLoading } = useQuery({
    queryKey: ["browse", snapshotDate, path],
    queryFn: () =>
      getBrowse({
        snapshot_date: snapshotDate,
        parent_path: path,
        limit: 1000,
      }),
    enabled: isExpanded && isDirectory,
  });

  const hasChildren = data && data.folders.length > 0;

  // Calculate reference size for children (use recursive sizes for accurate percentages)
  let childReferenceSize = referenceSize;
  if (state.referenceMode === "directory" && isExpanded && data) {
    // Sum of all children's recursive sizes for this directory
    childReferenceSize = data.folders.reduce((sum: number, e) => sum + (e.recursive_size || e.size), 0);
  }

  const handleToggle = () => {
    if (isDirectory) {
      setIsExpanded(!isExpanded);
      setSelectedPath(path);
    }
  };

  // Calculate percentage using recursive size (true directory weight)
  const displaySize = recursiveSize || size;  // Use recursive size for dirs, regular size for files
  const percent = referenceSize > 0 ? (displaySize / referenceSize) * 100 : 0;

  // Softer color scheme
  const getBarColor = (pct: number) => {
    if (pct > 50) return "bg-red-400/40";      // Soft red
    if (pct > 20) return "bg-amber-400/40";    // Soft amber
    if (pct > 5) return "bg-sky-400/40";       // Soft sky blue
    return "bg-slate-400/30";                   // Subtle slate
  };

  const isCustomReference = state.customReferencePath === path;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1 hover:bg-accent/30 cursor-pointer group relative",
          "border-l border-transparent hover:border-primary/20 transition-colors",
          isCustomReference && "bg-primary/5 border-l-2 border-primary/50"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleToggle}
      >
        {/* Chevron and folder icon */}
        <div className="flex items-center gap-1.5 flex-shrink-0 min-w-[52px]">
          <ChevronRight
            className={cn(
              "w-3 h-3 text-muted-foreground/60 transition-transform",
              isExpanded && "rotate-90"
            )}
          />
          {isExpanded ? (
            <FolderOpen className="w-3.5 h-3.5 text-amber-400/80" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-amber-500/80" />
          )}
        </div>

        {/* Name with counts */}
        <div className="flex items-baseline gap-2 min-w-[180px] max-w-[280px]">
          <span className="text-xs font-medium truncate">{name}</span>
          {isDirectory && fileCount !== undefined && (
            <span className="text-xs text-muted-foreground/50 font-mono flex-shrink-0">
              ({fileCount}f)
            </span>
          )}
        </div>

        {/* Size bar */}
        <div className="flex-1 flex items-center gap-2 min-w-[200px]">
          <div className="flex-1 h-3 bg-muted/20 rounded-sm overflow-hidden">
            <div
              className={cn("h-full transition-all", getBarColor(percent))}
              style={{ width: `${Math.min(Math.max(percent, 1), 100)}%` }}
            />
          </div>

          <span className="text-xs font-mono text-foreground/80 min-w-[65px] text-right">
            {recursiveSizeFormatted || sizeFormatted}
          </span>
          <span className="text-xs font-mono text-muted-foreground/60 min-w-[48px] text-right">
            {percent.toFixed(1)}%
          </span>
        </div>

        {/* Last access (always visible) */}
        <span className="text-xs font-mono text-muted-foreground/50 min-w-[45px] text-right flex-shrink-0">
          {formatDate(accessedTime || modifiedTime)}
        </span>

        {/* Set reference button (folders only) */}
        {isDirectory && onSetReference && (
          <Button
            variant="ghost"
            size="sm"
            className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0 ml-2"
            onClick={(e) => {
              e.stopPropagation();
              onSetReference(path, displaySize);
            }}
            title="Set as reference for percentages"
          >
            <Target className="w-3 h-3" />
          </Button>
        )}
      </div>

      {/* Children */}
      {isExpanded && isDirectory && (
        <div>
          {isLoading && (
            <div
              className="text-xs text-muted-foreground/50 px-2 py-1"
              style={{ paddingLeft: `${(level + 1) * 12 + 24}px` }}
            >
              Loading...
            </div>
          )}
          {hasChildren &&
            data.folders.map((folder) => (
              <TreeNode
                key={folder.path}
                path={folder.path}
                name={folder.name}
                snapshotDate={snapshotDate}
                level={level + 1}
                isDirectory={folder.is_directory}
                size={folder.size}
                sizeFormatted={folder.size_formatted || ""}
                recursiveSize={folder.recursive_size}
                recursiveSizeFormatted={folder.recursive_size_formatted}
                fileCount={folder.file_count}
                dirCount={folder.dir_count}
                owner={folder.owner}
                modifiedTime={folder.modified_time}
                accessedTime={folder.accessed_time}
                fileType={folder.file_type}
                referenceSize={childReferenceSize}
                state={state}
                onSetReference={onSetReference}
              />
            ))}
          {isExpanded && !isLoading && !hasChildren && (
            <div
              className="text-xs text-muted-foreground/40 px-2 py-1 italic"
              style={{ paddingLeft: `${(level + 1) * 12 + 24}px` }}
            >
              Empty directory
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DiskUsageExplorerV2() {
  const { selectedSnapshot } = useAppStore();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [state, setState] = useState<DiskUsageState>({
    referenceMode: "directory",
    customReferencePath: null,
    customReferenceSize: null,
  });

  // Fetch root browse to calculate project size (use recursive sizes)
  const { data: rootData } = useQuery({
    queryKey: ["browse", selectedSnapshot, "/project/cil"],
    queryFn: () =>
      getBrowse({
        snapshot_date: selectedSnapshot!,
        parent_path: "/project/cil",
        limit: 1000,
      }),
    enabled: !!selectedSnapshot,
  });

  // Calculate total project size from recursive folder sizes (true total)
  const projectSize = rootData
    ? rootData.folders.reduce((sum: number, e) => sum + (e.recursive_size || e.size), 0)
    : 0;

  // Determine reference size based on mode
  let referenceSize = projectSize;
  if (state.referenceMode === "custom" && state.customReferenceSize) {
    referenceSize = state.customReferenceSize;
  } else if (state.referenceMode === "directory") {
    referenceSize = projectSize; // Will be recalculated per-directory
  }

  // ESC to exit fullscreen
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

  const handleSetReference = (path: string, size: number) => {
    setState({
      referenceMode: "custom",
      customReferencePath: path,
      customReferenceSize: size,
    });
  };

  if (!selectedSnapshot) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-sm text-muted-foreground">
            Select a snapshot to explore disk usage
          </div>
        </CardContent>
      </Card>
    );
  }

  const content = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 pb-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold">Disk Usage Explorer</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {selectedSnapshot} · {(projectSize / 1024 ** 3).toFixed(2)} GiB total
            {state.referenceMode === "custom" && state.customReferencePath && (
              <span className="ml-2 text-primary/70">
                · ref: {state.customReferencePath}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isFullscreen && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(true)}
              className="gap-1.5 h-7"
            >
              <Maximize2 className="w-3 h-3" />
              <span className="text-xs">Fullscreen</span>
            </Button>
          )}
          {isFullscreen && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(false)}
              className="gap-1.5 h-7"
            >
              <Minimize2 className="w-3 h-3" />
              <span className="text-xs">Exit (ESC)</span>
            </Button>
          )}
        </div>
      </div>

      {/* Reference mode controls */}
      <div className="flex items-center gap-4 text-xs mb-3 pb-3 border-b border-border/30">
        <span className="text-muted-foreground">Percentages relative to:</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            checked={state.referenceMode === "directory"}
            onChange={() =>
              setState({ referenceMode: "directory", customReferencePath: null, customReferenceSize: null })
            }
            className="w-3 h-3"
          />
          <span>Current directory</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            checked={state.referenceMode === "project"}
            onChange={() =>
              setState({ referenceMode: "project", customReferencePath: null, customReferenceSize: null })
            }
            className="w-3 h-3"
          />
          <span>Entire project ({(projectSize / 1024 ** 3).toFixed(1)} GiB)</span>
        </label>
        {state.referenceMode === "custom" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setState({ referenceMode: "directory", customReferencePath: null, customReferenceSize: null })
            }
            className="h-6 text-xs"
          >
            Clear custom
          </Button>
        )}
        <span className="ml-auto text-muted-foreground/60">
          Click <Target className="w-3 h-3 inline" /> to set custom reference
        </span>
      </div>

      {/* Important notice about data semantics */}
      <div className="bg-muted/30 border border-border/50 rounded-sm px-3 py-2 mb-3 text-xs text-muted-foreground">
        <strong className="text-foreground/80">Note:</strong> This view shows{" "}
        <strong>directories only</strong> with <strong>recursive subtree sizes</strong>.
        Directory sizes include all files and subdirectories recursively.
        Percentages are calculated from these recursive totals.
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {rootData && rootData.folders.length > 0 ? (
          rootData.folders.map((folder) => (
            <TreeNode
              key={folder.path}
              path={folder.path}
              name={folder.name}
              snapshotDate={selectedSnapshot}
              level={0}
              isDirectory={folder.is_directory}
              size={folder.size}
              sizeFormatted={folder.size_formatted || ""}
              recursiveSize={folder.recursive_size}
              recursiveSizeFormatted={folder.recursive_size_formatted}
              fileCount={folder.file_count}
              dirCount={folder.dir_count}
              owner={folder.owner}
              modifiedTime={folder.modified_time}
              accessedTime={folder.accessed_time}
              fileType={folder.file_type}
              referenceSize={state.referenceMode === "project" ? projectSize : projectSize}
              state={state}
              onSetReference={handleSetReference}
            />
          ))
        ) : (
          <div className="text-sm text-muted-foreground p-4">Loading...</div>
        )}
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
