"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowse, getContents, getSnapshots } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  File,
  Folder,
  Maximize2,
  Minimize2,
  Target,
} from "lucide-react";
import { getFileIcon, getFolderIcon, getSizeColor } from "@/lib/utils/icon-helpers";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { DirectoryEntry } from "@/lib/types";

type SortMode = "name" | "size" | "modified";

interface DiskUsageState {
  referencePath: string | null;
  referenceSize: number | null;
  sortMode: SortMode;
  selectedPath: string | null;
}

// Hard-coded quotas
const STORAGE_QUOTA_TB = 500;
const FILE_COUNT_QUOTA = 77_000_000;

function getQuotaColor(percent: number): string {
  if (percent >= 95) return "bg-red-600/70";
  if (percent >= 85) return "bg-red-500/65";
  if (percent >= 75) return "bg-orange-500/65";
  if (percent >= 65) return "bg-orange-400/60";
  if (percent >= 50) return "bg-yellow-400/60";
  if (percent >= 35) return "bg-yellow-300/55";
  if (percent >= 25) return "bg-lime-400/55";
  if (percent >= 15) return "bg-green-400/60";
  if (percent >= 5) return "bg-green-500/65";
  return "bg-green-600/70";
}

function getQuotaTextColor(percent: number): string {
  if (percent >= 95) return "text-red-600";
  if (percent >= 85) return "text-red-500";
  if (percent >= 75) return "text-orange-500";
  if (percent >= 65) return "text-orange-400";
  if (percent >= 50) return "text-yellow-400";
  if (percent >= 35) return "text-yellow-300";
  if (percent >= 25) return "text-lime-400";
  if (percent >= 15) return "text-green-400";
  if (percent >= 5) return "text-green-500";
  return "text-green-600";
}

interface TreeNodeProps {
  path: string;
  name: string;
  snapshotDate: string;
  level: number;
  isDirectory: boolean;
  size: number;
  sizeFormatted: string;
  recursiveSize?: number;
  recursiveSizeFormatted?: string;
  fileCount?: number;
  dirCount?: number;
  owner?: string;
  modifiedTime?: number;
  accessedTime?: number;
  fileType?: string;
  referenceSize: number;
  state: DiskUsageState;
  setState: React.Dispatch<React.SetStateAction<DiskUsageState>>;
  onSetReference?: (path: string, size: number) => void;
  isInsideReference: boolean;
  parentPath: string;
  preLoadedFolders?: DirectoryEntry[];
  onDataLoaded?: (totalSize: number) => void; 
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

function sortEntries(entries: DirectoryEntry[], sortMode: SortMode): DirectoryEntry[] {
  const sorted = [...entries];

  switch (sortMode) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "size":
      sorted.sort((a, b) => {
        const aSize = a.recursive_size || a.size;
        const bSize = b.recursive_size || b.size;
        return bSize - aSize; 
      });
      break;
    case "modified":
      sorted.sort((a, b) => {
        const aTime = a.modified_time || 0;
        const bTime = b.modified_time || 0;
        return bTime - aTime; 
      });
      break;
  }
  const folders = sorted.filter((e) => e.is_directory);
  const files = sorted.filter((e) => !e.is_directory);
  return [...folders, ...files];
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
  setState,
  onSetReference,
  isInsideReference,
  parentPath,
  preLoadedFolders,
  onDataLoaded,
}: TreeNodeProps) {
  const shouldAutoExpand = state.referencePath && (
    path === state.referencePath ||
    state.referencePath.startsWith(path + '/')
  );

  const [isExpanded, setIsExpanded] = useState(shouldAutoExpand || false);
  const { setSelectedPath } = useAppStore();

  useEffect(() => {
    if (shouldAutoExpand && !isExpanded) {
      setIsExpanded(true);
    }
  }, [shouldAutoExpand, isExpanded]);

  const { data, isLoading } = useQuery({
    queryKey: ["node-data", snapshotDate, path],
    queryFn: async () => {
      if (preLoadedFolders) {
        const filesData = await getContents({
          snapshot_date: snapshotDate,
          parent_path: path,
          limit: 1000,
          sort: "size_desc",
        });
        return {
          folders: preLoadedFolders,
          files: filesData.entries.filter((e: DirectoryEntry) => !e.is_directory),
        };
      }

      const [foldersRes, filesRes] = await Promise.all([
        getBrowse({
          snapshot_date: snapshotDate,
          parent_path: path,
          limit: 1000,
        }),
        getContents({
          snapshot_date: snapshotDate,
          parent_path: path,
          limit: 1000,
          sort: "size_desc",
        }),
      ]);

      return {
        folders: foldersRes.folders || [],
        files: filesRes.entries.filter((e: DirectoryEntry) => !e.is_directory) || [],
      };
    },
    enabled: isExpanded && isDirectory,
    staleTime: 1000 * 60 * 5, 
  });

  useEffect(() => {
    if (data && onDataLoaded) {
      const foldersSize = (data.folders || []).reduce((acc, curr) => acc + (curr.recursive_size || curr.size), 0);
      const filesSize = (data.files || []).reduce((acc, curr) => acc + curr.size, 0);
      const totalSize = foldersSize + filesSize;
      onDataLoaded(totalSize);
    }
  }, [data, onDataLoaded]);

  const unsortedEntries: DirectoryEntry[] = [
    ...(data?.folders || []),
    ...(data?.files || []),
  ];

  const allEntries = sortEntries(unsortedEntries, state.sortMode);
  const hasChildren = allEntries.length > 0;

  const displaySize = recursiveSize || size;
  const percent = referenceSize > 0 ? (displaySize / referenceSize) * 100 : 0;

  const isReferenceRow = state.referencePath === path;
  const isSelectedRow = state.selectedPath === path;

  const isActuallyInsideReference = state.referencePath
    ? (path === state.referencePath || path.startsWith(state.referencePath + '/'))
    : isInsideReference;

  const childReferenceSize = isReferenceRow || (isExpanded && isActuallyInsideReference && !isReferenceRow)
    ? displaySize
    : referenceSize;

  const handleToggle = () => {
    if (isDirectory) {
      setIsExpanded(!isExpanded);
      setSelectedPath(path);
    }
    setState((prev) => ({
      ...prev,
      selectedPath: prev.selectedPath === path ? null : path,
    }));
  };

  const shouldShowBar = !isReferenceRow && !isExpanded && isActuallyInsideReference;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1 hover:bg-accent/30 cursor-pointer group relative",
          "border-l-2 border-transparent hover:border-primary/20 transition-all duration-200",
          isReferenceRow && "bg-green-500/10 border-l-2 border-green-500/60 shadow-sm",
          isSelectedRow && !isReferenceRow && "border-b-2 border-cyan-500/60"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleToggle}
      >
        <div className="flex items-center gap-1.5 flex-shrink-0 min-w-[52px]">
          {isDirectory ? (
            <>
              <ChevronRight
                className={cn(
                  "w-3 h-3 text-muted-foreground/60 transition-transform",
                  isExpanded && "rotate-90"
                )}
              />
              {getFolderIcon(displaySize, isExpanded)}
            </>
          ) : (
            <>
              <span className="w-3 h-3" />
              {getFileIcon(name, fileType, size)}
            </>
          )}
        </div>

        <div className="flex items-baseline gap-2 min-w-[200px] max-w-[300px]">
          <span className="text-xs font-medium truncate">{name}</span>
          {isDirectory && (fileCount !== undefined || dirCount !== undefined) && (
            <span className="text-[10px] text-muted-foreground/50 font-mono flex-shrink-0 whitespace-nowrap flex items-center gap-1">
              <span className="flex items-center gap-0.5">
                <File className="w-2.5 h-2.5" />
                {fileCount || 0}
              </span>
              <span className="flex items-center gap-0.5">
                <Folder className="w-2.5 h-2.5" />
                {dirCount || 0}
              </span>
            </span>
          )}
        </div>

        <div className="flex-1 flex items-center gap-2 min-w-[200px]">
          {shouldShowBar ? (
            <>
              <div className="flex-1 h-3 bg-muted/15 rounded-sm overflow-hidden border border-border/30">
                <div
                  className={cn(
                    "h-full transition-all duration-300",
                    isDirectory ? "bg-foreground/25" : "bg-foreground/20"
                  )}
                  style={{
                    width: `${Math.min(Math.max(percent, 1), 100)}%`,
                    backgroundImage: isDirectory
                      ? "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.15) 2px, rgba(255,255,255,0.15) 5px)"
                      : "none",
                    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.12)"
                  }}
                />
              </div>

              <span className={cn("text-xs font-mono min-w-[65px] text-right font-medium", getSizeColor(displaySize))}>
                {recursiveSizeFormatted || sizeFormatted}
              </span>
              <span className="text-xs font-mono text-muted-foreground/60 min-w-[48px] text-right">
                {percent.toFixed(1)}%
              </span>
            </>
          ) : (
            <>
              <div className="flex-1" />
              <span className={cn("text-xs font-mono min-w-[65px] text-right font-medium", getSizeColor(displaySize))}>
                {recursiveSizeFormatted || sizeFormatted}
              </span>
              <span className="text-xs font-mono text-muted-foreground/60 min-w-[48px] text-right opacity-0">
                —
              </span>
            </>
          )}
        </div>

        <span className="text-xs font-mono text-muted-foreground/50 min-w-[45px] text-right flex-shrink-0">
          {formatDate(accessedTime || modifiedTime)}
        </span>

        {isDirectory && onSetReference && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 w-6 p-0 ml-2 transition-all",
              isReferenceRow ? "opacity-100 text-green-500" : "opacity-40 hover:opacity-100"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onSetReference(path, displaySize);
            }}
            title={isReferenceRow ? "Reference directory" : "Set as reference"}
          >
            <Target className="w-3 h-3" />
          </Button>
        )}
      </div>

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
            allEntries.map((entry) => (
              <TreeNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                snapshotDate={snapshotDate}
                level={level + 1}
                isDirectory={entry.is_directory}
                size={entry.size}
                sizeFormatted={entry.size_formatted || ""}
                recursiveSize={entry.recursive_size}
                recursiveSizeFormatted={entry.recursive_size_formatted}
                fileCount={entry.file_count}
                dirCount={entry.dir_count}
                owner={entry.owner}
                modifiedTime={entry.modified_time}
                accessedTime={entry.accessed_time}
                fileType={entry.file_type}
                referenceSize={childReferenceSize}
                state={state}
                setState={setState}
                onSetReference={onSetReference}
                isInsideReference={isReferenceRow || isActuallyInsideReference}
                parentPath={path}
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
  const { selectedSnapshot, referencePath, referenceSize, setReferencePath, setReferenceSize } = useAppStore();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [localProjectSize, setLocalProjectSize] = useState<number>(0);

  const [state, setState] = useState<DiskUsageState>({
    referencePath: referencePath,
    referenceSize: referenceSize,
    sortMode: "size",
    selectedPath: null,
  });

  const { data: snapshots } = useQuery({
    queryKey: ["snapshots"],
    queryFn: getSnapshots,
  });

  const currentSnapshot = snapshots?.find(s => s.snapshot_date === selectedSnapshot);

  // Progressive loading: use local size, global ref, or 0
  const projectSize = localProjectSize || referenceSize || 0;
  const effectiveReferenceSize = referenceSize || projectSize;

  const handleRootDataLoaded = (totalSize: number) => {
    setLocalProjectSize(totalSize);
    if (totalSize > 0 && referencePath === "/project/cil" && !referenceSize) {
      setReferenceSize(totalSize);
    }
  };

  const { data: selectedData } = useQuery({
    queryKey: ["browse", selectedSnapshot, state.selectedPath],
    queryFn: () =>
      getBrowse({
        snapshot_date: selectedSnapshot!,
        parent_path: state.selectedPath!,
        limit: 1,
      }),
    enabled: !!selectedSnapshot && !!state.selectedPath,
  });

  useEffect(() => {
    setState((prev) => ({
      ...prev,
      referencePath: referencePath,
      referenceSize: referenceSize,
    }));
  }, [referencePath, referenceSize]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) setIsFullscreen(false);
    };
    if (isFullscreen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isFullscreen]);

  const handleSetReference = (path: string, size: number) => {
    setReferencePath(path);
    setReferenceSize(size);
  };

  if (!selectedSnapshot) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-sm text-muted-foreground">Select a snapshot to explore disk usage</div>
        </CardContent>
      </Card>
    );
  }

  const storageTB = projectSize / (1024 ** 4);
  const storageQuotaPercent = (storageTB / STORAGE_QUOTA_TB) * 100;
  const totalFiles = currentSnapshot?.total_files || 0;
  const fileCountQuotaPercent = (totalFiles / FILE_COUNT_QUOTA) * 100;

  const content = (
    <div className="flex flex-col h-full">
      {/* Header with quota indicators */}
      <div className="border-b border-border/50 pb-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold">Disk Usage Explorer</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {selectedSnapshot}
              {state.referencePath && (
                <span className="ml-2 text-green-500/70">
                  · ref: {state.referencePath.split('/').pop()}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isFullscreen && (
              <Button variant="outline" size="sm" onClick={() => setIsFullscreen(true)} className="gap-1.5 h-7">
                <Maximize2 className="w-3 h-3" /> <span className="text-xs">Fullscreen</span>
              </Button>
            )}
            {isFullscreen && (
              <Button variant="outline" size="sm" onClick={() => setIsFullscreen(false)} className="gap-1.5 h-7">
                <Minimize2 className="w-3 h-3" /> <span className="text-xs">Exit (ESC)</span>
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2 min-w-[240px]">
            <span className="text-muted-foreground/70 font-mono">Storage:</span>
            <div className="flex-1 h-2 bg-muted/20 rounded-sm overflow-hidden border border-border/30">
              <div className={cn("h-full transition-all", getQuotaColor(storageQuotaPercent))}
                   style={{ width: `${Math.min(storageQuotaPercent, 100)}%` }} />
            </div>
            <span className="font-mono text-muted-foreground/80 min-w-[110px]">
              {storageTB.toFixed(1)} / {STORAGE_QUOTA_TB} TB
            </span>
            <span className={cn("font-mono font-medium min-w-[42px] text-right", getQuotaTextColor(storageQuotaPercent))}>
              ({storageQuotaPercent.toFixed(1)}%)
            </span>
          </div>

          <div className="flex items-center gap-2 min-w-[240px]">
            <span className="text-muted-foreground/70 font-mono">Files:</span>
            <div className="flex-1 h-2 bg-muted/20 rounded-sm overflow-hidden border border-border/30">
              <div className={cn("h-full transition-all", getQuotaColor(fileCountQuotaPercent))}
                   style={{ width: `${Math.min(fileCountQuotaPercent, 100)}%` }} />
            </div>
            <span className="font-mono text-muted-foreground/80 min-w-[110px]">
              {totalFiles.toLocaleString()} / {FILE_COUNT_QUOTA.toLocaleString()}
            </span>
            <span className={cn("font-mono font-medium min-w-[42px] text-right", getQuotaTextColor(fileCountQuotaPercent))}>
              ({fileCountQuotaPercent.toFixed(1)}%)
            </span>
          </div>
        </div>
      </div>

      {/* Sorting controls */}
      <div className="flex items-center gap-4 text-xs mb-3 pb-2 border-b border-border/20">
        <span className="text-muted-foreground">Sort:</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={state.sortMode === "name"} onChange={() => setState((prev) => ({ ...prev, sortMode: "name" }))} className="w-3 h-3" />
          <span>Name</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={state.sortMode === "size"} onChange={() => setState((prev) => ({ ...prev, sortMode: "size" }))} className="w-3 h-3" />
          <span>Size</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={state.sortMode === "modified"} onChange={() => setState((prev) => ({ ...prev, sortMode: "modified" }))} className="w-3 h-3" />
          <span>Modified</span>
        </label>
      </div>

      {/* Info Panels - RESTORED */}
      <div className="flex justify-end gap-3 mb-3">
        {/* Reference Directory Card */}
        <div className="w-[280px] bg-muted/20 border-2 border-green-500/40 rounded-md p-3">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/30">
            <Target className="w-3.5 h-3.5 text-green-500/70" />
            <h4 className="text-xs font-semibold text-green-500/90">Reference</h4>
          </div>

          <div className="space-y-1.5 text-[10px] font-mono">
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground/70">Path:</span>
              <span className="text-foreground/80 text-right break-all ml-2" title={state.referencePath || ""}>
                {state.referencePath || "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground/70">Size:</span>
              <span className="text-foreground/80">
                {referenceSize ? `${(referenceSize / 1024 ** 4).toFixed(2)} TiB` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground/70">Quota:</span>
              <span className={cn(
                "font-medium",
                referenceSize && ((referenceSize / 1024 ** 4) / STORAGE_QUOTA_TB * 100) > 90 ? "text-red-400" :
                referenceSize && ((referenceSize / 1024 ** 4) / STORAGE_QUOTA_TB * 100) > 75 ? "text-orange-400" :
                referenceSize && ((referenceSize / 1024 ** 4) / STORAGE_QUOTA_TB * 100) > 50 ? "text-yellow-400" :
                "text-green-400"
              )}>
                {referenceSize ? `${((referenceSize / 1024 ** 4) / STORAGE_QUOTA_TB * 100).toFixed(1)}%` : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Selected Item Card */}
        {state.selectedPath && (
          <div className="w-[280px] bg-muted/20 border-2 border-cyan-500/40 rounded-md p-3">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/30">
              {state.selectedPath && getFileIcon(
                state.selectedPath.split('/').pop() || "",
                undefined,
                0
              )}
              <h4 className="text-xs font-semibold text-cyan-400/90">Item</h4>
            </div>

            <div className="space-y-1.5 text-[10px] font-mono">
              <div className="flex justify-between items-start">
                <span className="text-muted-foreground/70">Path:</span>
                <span className="text-foreground/80 text-right break-all ml-2" title={state.selectedPath}>
                  {state.selectedPath}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground/70">Name:</span>
                <span className="text-foreground/80 truncate ml-2">
                  {state.selectedPath.split('/').pop() || "—"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legend - RESTORED */}
      <div className="bg-muted/20 border border-border/40 rounded-sm px-3 py-2 mb-3">
        <div className="grid grid-cols-3 gap-4 text-[10px]">
          <div className="flex flex-col">
            <div className="text-foreground/70 font-medium mb-1.5">Percentage Bars</div>
            <div className="space-y-1 mb-auto">
              <div className="flex items-center gap-1.5">
                <div className="w-6 h-2 bg-foreground/25 rounded-sm"
                     style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.15) 2px, rgba(255,255,255,0.15) 5px)" }} />
                <span className="text-muted-foreground/70">Folders</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-6 h-2 bg-foreground/20 rounded-sm" />
                <span className="text-muted-foreground/70">Files</span>
              </div>
            </div>
            <div className="mt-2 text-[9px] text-muted-foreground/60 leading-tight">
              Bars show % relative to reference. Visible bars always sum to 100%.
            </div>
          </div>

          <div className="flex flex-col">
            <div className="text-foreground/70 font-medium mb-1.5">Size Severity</div>
            <div className="space-y-0.5 mb-auto">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground/40">●</span>
                <span className="text-muted-foreground/70">Negligible (&lt;10MB)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-green-400">●</span>
                <span className="text-muted-foreground/70">Small (≥10MB)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-yellow-400">●</span>
                <span className="text-muted-foreground/70">Medium (≥1GB)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-orange-400">●</span>
                <span className="text-muted-foreground/70">Large (≥10GB)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-red-500">●</span>
                <span className="text-muted-foreground/70">Very large (≥50GB)</span>
              </div>
            </div>
            <div className="mt-2 text-[9px] text-muted-foreground/60 leading-tight">
              Applied to file/folder icons and size text.
            </div>
          </div>

          <div className="flex flex-col">
            <div className="text-foreground/70 font-medium mb-1.5">Reference Selection</div>
            <div className="flex items-center gap-1.5 mb-auto">
              <Target className="w-3 h-3 text-muted-foreground/70" />
              <span className="text-muted-foreground/70">Click to set reference</span>
            </div>
            <div className="mt-2 text-[9px] text-muted-foreground/60 leading-tight">
              Select any folder as baseline. Selected reference highlighted in green.
            </div>
          </div>
        </div>
      </div>

      {/* Main Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <TreeNode
          key={`/project/cil-${state.referencePath || 'default'}`}
          path="/project/cil"
          name="cil"
          snapshotDate={selectedSnapshot}
          level={0}
          isDirectory={true}
          size={projectSize}
          sizeFormatted={projectSize ? `${(projectSize / 1024 ** 4).toFixed(2)} TiB` : "Loading..."}
          recursiveSize={projectSize}
          recursiveSizeFormatted={projectSize ? `${(projectSize / 1024 ** 4).toFixed(2)} TiB` : "Loading..."}
          fileCount={undefined}
          dirCount={undefined}
          owner={undefined}
          modifiedTime={undefined}
          accessedTime={undefined}
          fileType={undefined}
          referenceSize={effectiveReferenceSize}
          state={state}
          setState={setState}
          onSetReference={handleSetReference}
          isInsideReference={true}
          parentPath="/project"
          onDataLoaded={handleRootDataLoaded}
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