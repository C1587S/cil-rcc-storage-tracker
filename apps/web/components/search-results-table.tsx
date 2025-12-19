"use client";

import { useState, useEffect } from "react";
import { DirectoryEntry } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SearchResultsTableProps {
  results: DirectoryEntry[];
  isLoading?: boolean;
  totalCount: number;
}

interface ColumnWidths {
  filename: number;
  path: number;
  size: number;
  owner: number;
  modified: number;
  accessed: number;
}

const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  filename: 180,
  path: 320,
  size: 100,
  owner: 120,
  modified: 140,
  accessed: 140,
};

function formatReadableSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return "-";
  try {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  } catch {
    return "-";
  }
}

function extractFilename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function generateMarkdownTable(results: DirectoryEntry[]): string {
  const headers = ["Filename", "Full Path", "Size", "Owner", "Modified", "Accessed"];
  const separator = headers.map(() => "---").join(" | ");

  const rows = results.map((entry) => {
    const filename = extractFilename(entry.path);
    const modified = entry.modified_time
      ? formatTimestamp(entry.modified_time)
      : "-";
    const accessed = entry.accessed_time
      ? formatTimestamp(entry.accessed_time)
      : "-";

    return [
      filename,
      entry.path,
      formatReadableSize(entry.size),
      entry.owner || "-",
      modified,
      accessed,
    ].join(" | ");
  });

  return [
    headers.join(" | "),
    separator,
    ...rows,
  ].join("\n");
}

function downloadAsCSV(results: DirectoryEntry[]) {
  const headers = ["Filename", "Full Path", "Size (bytes)", "Size (readable)", "Owner", "Modified", "Accessed"];
  const rows = results.map((entry) => [
    extractFilename(entry.path),
    entry.path,
    entry.size.toString(),
    formatReadableSize(entry.size),
    entry.owner || "",
    entry.modified_time ? new Date(entry.modified_time * 1000).toISOString() : "",
    entry.accessed_time ? new Date(entry.accessed_time * 1000).toISOString() : "",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `search-results-${Date.now()}.csv`;
  link.click();
}

function downloadAsTXT(results: DirectoryEntry[]) {
  const lines = [
    "SEARCH RESULTS",
    "=".repeat(80),
    "",
    `Total: ${results.length} results`,
    "",
    ...results.map((entry, idx) => {
      const filename = extractFilename(entry.path);
      return [
        `[${idx + 1}] ${filename}`,
        `    Path:     ${entry.path}`,
        `    Size:     ${formatReadableSize(entry.size)} (${entry.size.toLocaleString()} bytes)`,
        `    Owner:    ${entry.owner || "-"}`,
        `    Modified: ${entry.modified_time ? new Date(entry.modified_time * 1000).toISOString() : "-"}`,
        `    Accessed: ${entry.accessed_time ? new Date(entry.accessed_time * 1000).toISOString() : "-"}`,
        "",
      ].join("\n");
    }),
  ].join("\n");

  const blob = new Blob([lines], { type: "text/plain;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `search-results-${Date.now()}.txt`;
  link.click();
}

export function SearchResultsTable({ results, isLoading, totalCount }: SearchResultsTableProps) {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(DEFAULT_COLUMN_WIDTHS);
  const [resizingColumn, setResizingColumn] = useState<keyof ColumnWidths | null>(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);
  const [viewMode, setViewMode] = useState<"table" | "markdown">("table");

  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingColumn) return;
      const diff = e.clientX - startX;
      const newWidth = Math.max(80, startWidth + diff); // Minimum 80px
      setColumnWidths((prev) => ({
        ...prev,
        [resizingColumn]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingColumn, startX, startWidth]);

  const handleResizeStart = (column: keyof ColumnWidths, e: React.MouseEvent) => {
    e.preventDefault();
    setResizingColumn(column);
    setStartX(e.clientX);
    setStartWidth(columnWidths[column]);
  };

  if (isLoading) {
    return (
      <div className="border border-border/30 rounded-sm bg-muted/5">
        <div className="p-8 text-center text-xs text-muted-foreground font-mono">
          Searching...
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="border border-border/30 rounded-sm bg-muted/5">
        <div className="p-8 text-center text-xs text-muted-foreground font-mono">
          No results found
        </div>
      </div>
    );
  }

  const handleCopyMarkdown = () => {
    const markdown = generateMarkdownTable(results);
    navigator.clipboard.writeText(markdown);
  };

  return (
    <div className="border border-border/30 rounded-sm overflow-hidden">
      {/* Header with view mode toggle and download buttons */}
      <div className="bg-muted/10 border-b border-border/30 flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-mono text-muted-foreground">
            {results.length} of {totalCount.toLocaleString()} results
            {totalCount > results.length && " (server limit)"}
          </div>

          {/* View Mode Toggle */}
          <div className="flex gap-1 border border-border/20 rounded-sm overflow-hidden">
            <button
              onClick={() => setViewMode("table")}
              className={`px-2 py-0.5 text-[10px] font-mono transition-colors ${
                viewMode === "table"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/20"
              }`}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode("markdown")}
              className={`px-2 py-0.5 text-[10px] font-mono transition-colors ${
                viewMode === "markdown"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/20"
              }`}
            >
              Markdown
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          {viewMode === "markdown" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyMarkdown}
              className="h-6 px-2 text-[10px] font-mono"
            >
              Copy
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadAsCSV(results)}
            className="h-6 px-2 text-[10px] font-mono"
          >
            <Download className="h-3 w-3 mr-1" />
            CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadAsTXT(results)}
            className="h-6 px-2 text-[10px] font-mono"
          >
            <Download className="h-3 w-3 mr-1" />
            TXT
          </Button>
        </div>
      </div>

      {/* Markdown View */}
      {viewMode === "markdown" && (
        <div className="bg-background p-4 max-h-[500px] overflow-auto">
          <pre className="text-[11px] font-mono text-foreground whitespace-pre">
            {generateMarkdownTable(results)}
          </pre>
        </div>
      )}

      {/* Table container with horizontal scroll */}
      {viewMode === "table" && (
      <div className="overflow-x-auto">
        {/* Table header - fixed widths, resizable */}
        <div className="bg-muted/10 border-b border-border/30 select-none">
          <div className="flex items-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            {/* Filename */}
            <div
              className="px-3 py-2 font-mono flex-shrink-0 relative border-r border-border/20"
              style={{ width: columnWidths.filename }}
            >
              Filename
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
                onMouseDown={(e) => handleResizeStart("filename", e)}
              />
            </div>

            {/* Path */}
            <div
              className="px-3 py-2 font-mono flex-shrink-0 relative border-r border-border/20"
              style={{ width: columnWidths.path }}
            >
              Full Path
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
                onMouseDown={(e) => handleResizeStart("path", e)}
              />
            </div>

            {/* Size */}
            <div
              className="px-3 py-2 font-mono text-right flex-shrink-0 relative border-r border-border/20"
              style={{ width: columnWidths.size }}
            >
              Size
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
                onMouseDown={(e) => handleResizeStart("size", e)}
              />
            </div>

            {/* Owner */}
            <div
              className="px-3 py-2 font-mono flex-shrink-0 relative border-r border-border/20"
              style={{ width: columnWidths.owner }}
            >
              Owner
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
                onMouseDown={(e) => handleResizeStart("owner", e)}
              />
            </div>

            {/* Modified */}
            <div
              className="px-3 py-2 font-mono flex-shrink-0 relative border-r border-border/20"
              style={{ width: columnWidths.modified }}
            >
              Modified
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
                onMouseDown={(e) => handleResizeStart("modified", e)}
              />
            </div>

            {/* Accessed */}
            <div
              className="px-3 py-2 font-mono flex-shrink-0 relative"
              style={{ width: columnWidths.accessed }}
            >
              Accessed
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
                onMouseDown={(e) => handleResizeStart("accessed", e)}
              />
            </div>
          </div>
        </div>

        {/* Results with vertical scrolling - fixed column widths */}
        <div className="divide-y divide-border/30 bg-background max-h-[500px] overflow-y-auto">
          {results.map((entry, idx) => {
            const filename = extractFilename(entry.path);
            return (
              <div
                key={`${entry.path}-${idx}`}
                className="flex items-center text-xs hover:bg-muted/5 transition-colors"
              >
                {/* Filename */}
                <div
                  className="px-3 py-2 font-mono text-foreground flex-shrink-0 truncate border-r border-border/10"
                  style={{ width: columnWidths.filename }}
                  title={filename}
                >
                  {filename}
                </div>

                {/* Path */}
                <div
                  className="px-3 py-2 font-mono text-muted-foreground flex-shrink-0 truncate border-r border-border/10"
                  style={{ width: columnWidths.path }}
                  title={entry.path}
                >
                  {entry.path}
                </div>

                {/* Size */}
                <div
                  className="px-3 py-2 font-mono text-right text-muted-foreground flex-shrink-0 border-r border-border/10"
                  style={{ width: columnWidths.size }}
                >
                  {formatReadableSize(entry.size)}
                </div>

                {/* Owner */}
                <div
                  className="px-3 py-2 font-mono text-muted-foreground flex-shrink-0 truncate border-r border-border/10"
                  style={{ width: columnWidths.owner }}
                  title={entry.owner || "-"}
                >
                  {entry.owner || "-"}
                </div>

                {/* Modified */}
                <div
                  className="px-3 py-2 font-mono text-muted-foreground flex-shrink-0 border-r border-border/10"
                  style={{ width: columnWidths.modified }}
                >
                  {formatTimestamp(entry.modified_time)}
                </div>

                {/* Accessed */}
                <div
                  className="px-3 py-2 font-mono text-muted-foreground flex-shrink-0"
                  style={{ width: columnWidths.accessed }}
                >
                  {formatTimestamp(entry.accessed_time)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}
