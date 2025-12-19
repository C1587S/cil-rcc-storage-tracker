"use client";

import { useQuery } from "@tanstack/react-query";
import { getBrowse } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronRight, Folder } from "lucide-react";
import { useState } from "react";

interface FolderTreeNodeProps {
  path: string;
  name: string;
  snapshotDate: string;
  level: number;
}

function FolderTreeNode({ path, name, snapshotDate, level }: FolderTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { setSelectedPath } = useAppStore();

  const { data, isLoading } = useQuery({
    queryKey: ["browse", snapshotDate, path],
    queryFn: () => getBrowse({ snapshot_date: snapshotDate, parent_path: path }),
    enabled: isExpanded,
  });

  // Debug logging
  if (isExpanded) {
    console.log(`FolderTreeNode[${path}] - data:`, data);
    console.log(`FolderTreeNode[${path}] - isLoading:`, isLoading);
  }

  const hasChildren = data && data.folders.length > 0;

  const handleToggle = () => {
    console.log(`Toggling folder: ${path}`);
    setIsExpanded(!isExpanded);
    setSelectedPath(path);
  };

  return (
    <div>
      <div
        className="flex items-center gap-2 px-2 py-1 hover:bg-accent cursor-pointer rounded text-sm"
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleToggle}
      >
        <ChevronRight
          className={`w-4 h-4 transition-transform ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
        <Folder className="w-4 h-4 text-primary" />
        <span className="truncate">{name}</span>
      </div>

      {isExpanded && (
        <div>
          {isLoading && (
            <div
              className="text-xs text-muted-foreground px-2 py-1"
              style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }}
            >
              Loading...
            </div>
          )}
          {hasChildren &&
            data.folders.map((folder) => (
              <FolderTreeNode
                key={folder.path}
                path={folder.path}
                name={folder.name}
                snapshotDate={snapshotDate}
                level={level + 1}
              />
            ))}
          {isExpanded && !isLoading && !hasChildren && (
            <div
              className="text-xs text-muted-foreground px-2 py-1"
              style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }}
            >
              No subfolders
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FolderExplorer() {
  const { selectedSnapshot } = useAppStore();

  console.log("FolderExplorer - selectedSnapshot:", selectedSnapshot);

  if (!selectedSnapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Folders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">
            Select a snapshot to explore folders
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Folders</CardTitle>
      </CardHeader>
      <CardContent className="max-h-[600px] overflow-y-auto">
        <FolderTreeNode
          path="/project/cil"
          name="/project/cil"
          snapshotDate={selectedSnapshot}
          level={0}
        />
      </CardContent>
    </Card>
  );
}
