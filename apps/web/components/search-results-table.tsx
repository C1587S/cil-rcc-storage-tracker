"use client";

import { useState, useEffect, useMemo } from "react";
import { DirectoryEntry } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { Download, ChevronDown, ChevronUp, ChevronsUpDown, FileText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SearchResultsTableProps {
  results: DirectoryEntry[];
  isLoading?: boolean;
  totalCount: number;
  onAddToReport?: (entry: {
    mode: "filters";
    sql: string;
    columns: string[];
    rows: any[][];
    rowCount: number;
  }) => void;
  searchFilters?: Record<string, any>;
}

interface ColumnWidths {
  filename: number;
  parent_dir: number;
  top_level_dir: number;
  path: number;
  size: number;
  owner: number;
  modified: number;
  accessed: number;
}

const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  filename: 150,
  parent_dir: 120,
  top_level_dir: 100,
  path: 280,
  size: 100,
  owner: 120,
  modified: 140,
  accessed: 140,
};

type SortField = keyof ColumnWidths;
type SortDirection = "asc" | "desc" | null;

interface EnrichedEntry extends DirectoryEntry {
  parent_dir: string;
  top_level_dir: string;
}

interface AggregationConfig {
  groupBy: ("parent_dir" | "top_level_dir" | "owner" | "file_type")[];
  metrics: ("count" | "sum" | "avg")[];
}

interface AggregationRow {
  keys: Record<string, string>;
  count: number;
  totalSize: number;
  avgSize: number;
}

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

function extractParentDir(path: string): string {
  const parts = path.split("/").filter(p => p);
  if (parts.length <= 1) return "-";
  return parts[parts.length - 2] || "-";
}

function extractTopLevelDir(path: string): string {
  // Assumes paths like /project/cil/gcp/... where top-level is "gcp"
  const parts = path.split("/").filter(p => p);
  if (parts.length < 3) return "-";
  return parts[2] || "-"; // Index 2 = third segment after /project/cil/
}

function enrichEntry(entry: DirectoryEntry): EnrichedEntry {
  return {
    ...entry,
    parent_dir: extractParentDir(entry.path),
    top_level_dir: extractTopLevelDir(entry.path),
  };
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

export function SearchResultsTable({
  results,
  isLoading,
  totalCount,
  onAddToReport,
  searchFilters
}: SearchResultsTableProps) {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(DEFAULT_COLUMN_WIDTHS);
  const [resizingColumn, setResizingColumn] = useState<keyof ColumnWidths | null>(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);
  const [viewMode, setViewMode] = useState<"table" | "markdown">("table");
  const [sortField, setSortField] = useState<SortField | null>("size");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [showAggregation, setShowAggregation] = useState(false);
  const [aggGroupBy, setAggGroupBy] = useState<("parent_dir" | "top_level_dir" | "owner" | "file_type")[]>(["top_level_dir"]);
  const [postQueryFilter, setPostQueryFilter] = useState("");
  const [includeRegex, setIncludeRegex] = useState(false);
  const [excludeFilter, setExcludeFilter] = useState("");
  const [excludeRegex, setExcludeRegex] = useState(false);
  const [copied, setCopied] = useState(false);
  const [highlightedCols, setHighlightedCols] = useState<Set<string>>(new Set());
  const [highlightedRows, setHighlightedRows] = useState<Set<number>>(new Set());

  const toggleRow = (idx: number) => setHighlightedRows(prev => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });

  const toggleCol = (col: string) => setHighlightedCols(prev => {
    const next = new Set(prev);
    if (next.has(col)) next.delete(col); else next.add(col);
    return next;
  });

  const colHeaderClass = (col: string) => highlightedCols.has(col)
    ? "bg-primary/15 text-primary"
    : "hover:bg-muted/20";

  const cellClass = (col: string, rowIdx: number) => {
    const isCol = highlightedCols.has(col);
    const isRow = highlightedRows.has(rowIdx);
    if (isCol && isRow) return "bg-primary/20 text-foreground font-semibold";
    if (isCol) return "bg-primary/10 text-foreground";
    if (isRow) return "text-foreground";
    return "";
  };

  // Enrich results with derived columns
  const enrichedResults = useMemo(() => results.map(enrichEntry), [results]);

  // Client-side sorting
  const sortedResults = useMemo(() => {
    if (!sortField || !sortDirection) return enrichedResults;

    return [...enrichedResults].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (sortField === "filename") {
        aVal = extractFilename(a.path).toLowerCase();
        bVal = extractFilename(b.path).toLowerCase();
      } else if (sortField === "parent_dir") {
        aVal = a.parent_dir.toLowerCase();
        bVal = b.parent_dir.toLowerCase();
      } else if (sortField === "top_level_dir") {
        aVal = a.top_level_dir.toLowerCase();
        bVal = b.top_level_dir.toLowerCase();
      } else if (sortField === "path") {
        aVal = a.path.toLowerCase();
        bVal = b.path.toLowerCase();
      } else if (sortField === "size") {
        aVal = a.size;
        bVal = b.size;
      } else if (sortField === "owner") {
        aVal = (a.owner || "").toLowerCase();
        bVal = (b.owner || "").toLowerCase();
      } else if (sortField === "modified") {
        aVal = a.modified_time || 0;
        bVal = b.modified_time || 0;
      } else if (sortField === "accessed") {
        aVal = a.accessed_time || 0;
        bVal = b.accessed_time || 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [enrichedResults, sortField, sortDirection]);

  // Post-query filtering (include)
  const filteredResults = useMemo(() => {
    const term = postQueryFilter.trim();
    if (!term) return sortedResults;

    const getFields = (entry: any) => [
      extractFilename(entry.path),
      entry.path,
      entry.owner || "",
      entry.parent_dir,
      entry.top_level_dir,
    ].map(s => s.toLowerCase());

    if (includeRegex) {
      try {
        const re = new RegExp(term, "i");
        return sortedResults.filter(entry => getFields(entry).some(f => re.test(f)));
      } catch {
        return sortedResults;
      }
    }

    const patterns = term.split(",").map(p => p.trim().toLowerCase()).filter(Boolean);
    return sortedResults.filter(entry =>
      getFields(entry).some(f => patterns.some(p => f.includes(p)))
    );
  }, [sortedResults, postQueryFilter, includeRegex]);

  // Exclusion filtering (applied on top of filteredResults)
  const displayResults = useMemo(() => {
    const term = excludeFilter.trim();
    if (!term) return filteredResults;

    const matchesEntry = (entry: any): boolean => {
      const fields = [
        extractFilename(entry.path),
        entry.path,
        entry.owner || "",
        entry.parent_dir,
        entry.top_level_dir,
      ].map(s => s.toLowerCase());

      if (excludeRegex) {
        try {
          const re = new RegExp(term, "i");
          return fields.some(f => re.test(f));
        } catch {
          return false;
        }
      } else {
        const patterns = term.split(",").map(p => p.trim().toLowerCase()).filter(Boolean);
        return fields.some(f => patterns.some(p => f.includes(p)));
      }
    };

    return filteredResults.filter(entry => !matchesEntry(entry));
  }, [filteredResults, excludeFilter, excludeRegex]);

  // Compute aggregations
  const aggregations = useMemo(() => {
    if (!showAggregation || aggGroupBy.length === 0) return [];

    const groups = new Map<string, AggregationRow>();

    enrichedResults.forEach(entry => {
      const keyParts: string[] = [];
      const keyObj: Record<string, string> = {};

      aggGroupBy.forEach(field => {
        if (field === "parent_dir") {
          keyParts.push(entry.parent_dir);
          keyObj.parent_dir = entry.parent_dir;
        } else if (field === "top_level_dir") {
          keyParts.push(entry.top_level_dir);
          keyObj.top_level_dir = entry.top_level_dir;
        } else if (field === "owner") {
          keyParts.push(entry.owner || "-");
          keyObj.owner = entry.owner || "-";
        } else if (field === "file_type") {
          keyParts.push(entry.file_type || "-");
          keyObj.file_type = entry.file_type || "-";
        }
      });

      const key = keyParts.join("|");

      if (!groups.has(key)) {
        groups.set(key, {
          keys: keyObj,
          count: 0,
          totalSize: 0,
          avgSize: 0,
        });
      }

      const group = groups.get(key)!;
      group.count += 1;
      group.totalSize += entry.size;
    });

    // Calculate averages
    const result = Array.from(groups.values());
    result.forEach(row => {
      row.avgSize = row.count > 0 ? row.totalSize / row.count : 0;
    });

    // Sort by total size desc
    return result.sort((a, b) => b.totalSize - a.totalSize);
  }, [enrichedResults, showAggregation, aggGroupBy]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === "desc") {
        setSortDirection("asc");
      } else if (sortDirection === "asc") {
        setSortField(null);
        setSortDirection("desc");
      }
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
    }
    return sortDirection === "desc"
      ? <ChevronDown className="h-3 w-3" />
      : <ChevronUp className="h-3 w-3" />;
  };

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

  const handleCopyMarkdown = async () => {
    await navigator.clipboard.writeText(generateMarkdownTable(displayResults));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleAddToReport = () => {
    if (!onAddToReport) return;

    // Generate a readable SQL summary from search filters
    const filterParts: string[] = [];
    if (searchFilters?.searchText) {
      filterParts.push(`name search: "${searchFilters.searchText}" (${searchFilters.searchMode || 'contains'})`);
    }
    if (searchFilters?.scopePath) {
      filterParts.push(`scope: ${searchFilters.scopePath}`);
    }
    if (searchFilters?.fileType) {
      filterParts.push(`file type: ${searchFilters.fileType}`);
    }
    if (searchFilters?.minSize !== undefined || searchFilters?.maxSize !== undefined) {
      const sizeRange = [];
      if (searchFilters.minSize !== undefined) sizeRange.push(`min: ${formatReadableSize(searchFilters.minSize)}`);
      if (searchFilters.maxSize !== undefined) sizeRange.push(`max: ${formatReadableSize(searchFilters.maxSize)}`);
      filterParts.push(`size: ${sizeRange.join(', ')}`);
    }

    const sqlSummary = `-- Filter Builder Search\n-- ${filterParts.join(' | ')}\n-- Results: ${results.length} of ${totalCount}`;

    // Convert results to rows format matching QueryResultsTable
    const columns = ["Filename", "Full Path", "Size", "Owner", "Modified", "Accessed"];
    const rows = results.map(entry => [
      extractFilename(entry.path),
      entry.path,
      formatReadableSize(entry.size),
      entry.owner || "-",
      formatTimestamp(entry.modified_time),
      formatTimestamp(entry.accessed_time),
    ]);

    onAddToReport({
      mode: "filters",
      sql: sqlSummary,
      columns,
      rows,
      rowCount: results.length,
    });
  };

  return (
    <div className="border border-border/30 rounded-sm overflow-hidden">
      {/* Header with view mode toggle and download buttons */}
      <div className="bg-muted/10 border-b border-border/30 px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-[10px] font-mono text-muted-foreground">
              {displayResults.length}{(postQueryFilter || excludeFilter) ? ` filtered (of ${results.length})` : ` of ${totalCount.toLocaleString()} results`}
              {!postQueryFilter && !excludeFilter && totalCount > results.length && " (server limit)"}
            </div>

            {/* Include filter */}
            <div className="group relative flex items-center gap-0.5">
              <div className="relative">
                <input
                  type="text"
                  placeholder={includeRegex ? "e.g. \\.py$|report" : "e.g. data, report"}
                  value={postQueryFilter}
                  onChange={(e) => setPostQueryFilter(e.target.value)}
                  className="pl-6 pr-2 py-0.5 text-[10px] font-mono border border-sky-500/30 rounded-sm bg-sky-500/5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/20 w-36"
                />
                <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-sky-400/70" />
                {postQueryFilter && (
                  <button
                    onClick={() => setPostQueryFilter("")}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground text-[10px] px-1"
                  >×</button>
                )}
              </div>
              <button
                onClick={() => setIncludeRegex(r => !r)}
                className={`px-1.5 py-0.5 text-[9px] font-mono border rounded-sm transition-colors ${
                  includeRegex
                    ? "border-sky-500/50 bg-sky-500/15 text-sky-400"
                    : "border-border/20 text-muted-foreground/50 hover:border-sky-500/30 hover:text-sky-400/70"
                }`}
              >/rx</button>
              <div className="pointer-events-none absolute top-full left-0 mt-1.5 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                <div className="bg-popover border border-border/40 rounded px-2 py-1.5 text-[10px] text-muted-foreground shadow-md whitespace-nowrap">
                  Keep rows matching any pattern.<br />
                  Comma-separate for multiple. Toggle <span className="font-mono text-sky-400">/rx</span> for regex.
                </div>
              </div>
            </div>

            {/* Exclusion filter */}
            <div className="group relative flex items-center gap-0.5">
              <div className="relative">
                <input
                  type="text"
                  placeholder={excludeRegex ? "e.g. \\.log$|tmp" : "e.g. tmp, cache"}
                  value={excludeFilter}
                  onChange={(e) => setExcludeFilter(e.target.value)}
                  className="pl-6 pr-2 py-0.5 text-[10px] font-mono border border-rose-500/30 rounded-sm bg-rose-500/5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/20 w-36"
                />
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-rose-400/70 text-[10px] font-bold leading-none">−</span>
                {excludeFilter && (
                  <button
                    onClick={() => setExcludeFilter("")}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground text-[10px] px-1"
                  >×</button>
                )}
              </div>
              <button
                onClick={() => setExcludeRegex(r => !r)}
                className={`px-1.5 py-0.5 text-[9px] font-mono border rounded-sm transition-colors ${
                  excludeRegex
                    ? "border-rose-500/50 bg-rose-500/15 text-rose-400"
                    : "border-border/20 text-muted-foreground/50 hover:border-rose-500/30 hover:text-rose-400/70"
                }`}
              >/rx</button>
              <div className="pointer-events-none absolute top-full left-0 mt-1.5 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                <div className="bg-popover border border-border/40 rounded px-2 py-1.5 text-[10px] text-muted-foreground shadow-md whitespace-nowrap">
                  Remove rows matching any pattern.<br />
                  Comma-separate for multiple. Toggle <span className="font-mono text-rose-400">/rx</span> for regex.
                </div>
              </div>
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

            {/* Aggregation Toggle */}
            {viewMode === "table" && (
              <button
                onClick={() => setShowAggregation(!showAggregation)}
                className={`px-2 py-0.5 text-[10px] font-mono border border-border/20 rounded-sm transition-colors ${
                  showAggregation
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/20"
                }`}
              >
                Summary
              </button>
            )}
          </div>

          <div className="flex gap-2">
            {onAddToReport && (
              <Button
                variant="default"
                size="sm"
                onClick={handleAddToReport}
                className="h-6 px-2 text-[10px] font-mono bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
              >
                <FileText className="h-3 w-3 mr-1" />
                Add to Report
              </Button>
            )}
            {viewMode === "markdown" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyMarkdown}
                className={`h-6 px-2 text-[10px] font-mono transition-all duration-300 ${copied ? "text-emerald-500 bg-emerald-500/10" : ""}`}
              >
                {copied ? "Copied!" : "Copy"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadAsCSV(displayResults)}
              className="h-6 px-2 text-[10px] font-mono"
            >
              <Download className="h-3 w-3 mr-1" />
              CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => downloadAsTXT(displayResults)}
              className="h-6 px-2 text-[10px] font-mono"
            >
              <Download className="h-3 w-3 mr-1" />
              TXT
            </Button>
          </div>
        </div>

        {/* Aggregation Controls */}
        {showAggregation && viewMode === "table" && (
          <div className="mt-2 pt-2 border-t border-border/20 flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-mono">Group by:</span>
            <div className="flex gap-2">
              {(["top_level_dir", "parent_dir", "owner", "file_type"] as const).map(field => (
                <label key={field} className="flex items-center gap-1 text-[10px]">
                  <input
                    type="checkbox"
                    checked={aggGroupBy.includes(field)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setAggGroupBy([...aggGroupBy, field]);
                      } else {
                        setAggGroupBy(aggGroupBy.filter(f => f !== field));
                      }
                    }}
                    className="rounded border-border"
                  />
                  <span className="font-mono text-muted-foreground">{field.replace("_", " ")}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Markdown View */}
      {viewMode === "markdown" && (
        <div className="bg-background p-4 max-h-[500px] overflow-auto">
          <pre className="text-[11px] font-mono text-foreground whitespace-pre">
            {generateMarkdownTable(displayResults)}
          </pre>
        </div>
      )}

      {/* Table container with horizontal scroll */}
      {viewMode === "table" && (
      <div className="overflow-x-auto">
        {/* Table header - fixed widths, resizable, sortable */}
        <div className="bg-muted/10 border-b border-border/30 select-none">
          <div className="flex items-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            {/* Filename */}
            <div
              className={`px-3 py-2 font-mono flex-shrink-0 relative border-r border-border/20 cursor-pointer transition-colors ${colHeaderClass("filename")}`}
              style={{ width: columnWidths.filename }}
              onClick={(e) => { if (e.shiftKey) toggleCol("filename"); else handleSort("filename"); }}
            >
              <div className="flex items-center gap-1">
                <span>Filename</span>
                {getSortIcon("filename")}
              </div>
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                onMouseDown={(e) => handleResizeStart("filename", e)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Parent Dir */}
            <div
              className={`px-3 py-2 font-mono flex-shrink-0 relative border-r border-border/20 cursor-pointer transition-colors ${colHeaderClass("parent_dir")}`}
              style={{ width: columnWidths.parent_dir }}
              onClick={(e) => { if (e.shiftKey) toggleCol("parent_dir"); else handleSort("parent_dir"); }}
            >
              <div className="flex items-center gap-1">
                <span>Parent</span>
                {getSortIcon("parent_dir")}
              </div>
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                onMouseDown={(e) => handleResizeStart("parent_dir", e)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Top Level Dir */}
            <div
              className={`px-3 py-2 font-mono flex-shrink-0 relative border-r border-border/20 cursor-pointer transition-colors ${colHeaderClass("top_level_dir")}`}
              style={{ width: columnWidths.top_level_dir }}
              onClick={(e) => { if (e.shiftKey) toggleCol("top_level_dir"); else handleSort("top_level_dir"); }}
            >
              <div className="flex items-center gap-1">
                <span>Top Dir</span>
                {getSortIcon("top_level_dir")}
              </div>
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                onMouseDown={(e) => handleResizeStart("top_level_dir", e)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Path */}
            <div
              className={`px-3 py-2 font-mono flex-shrink-0 relative border-r border-border/20 cursor-pointer transition-colors ${colHeaderClass("path")}`}
              style={{ width: columnWidths.path }}
              onClick={(e) => { if (e.shiftKey) toggleCol("path"); else handleSort("path"); }}
            >
              <div className="flex items-center gap-1">
                <span>Full Path</span>
                {getSortIcon("path")}
              </div>
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                onMouseDown={(e) => handleResizeStart("path", e)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Size */}
            <div
              className={`px-3 py-2 font-mono text-right flex-shrink-0 relative border-r border-border/20 cursor-pointer transition-colors ${colHeaderClass("size")}`}
              style={{ width: columnWidths.size }}
              onClick={(e) => { if (e.shiftKey) toggleCol("size"); else handleSort("size"); }}
            >
              <div className="flex items-center justify-end gap-1">
                <span>Size</span>
                {getSortIcon("size")}
              </div>
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                onMouseDown={(e) => handleResizeStart("size", e)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Owner */}
            <div
              className={`px-3 py-2 font-mono flex-shrink-0 relative border-r border-border/20 cursor-pointer transition-colors ${colHeaderClass("owner")}`}
              style={{ width: columnWidths.owner }}
              onClick={(e) => { if (e.shiftKey) toggleCol("owner"); else handleSort("owner"); }}
            >
              <div className="flex items-center gap-1">
                <span>Owner</span>
                {getSortIcon("owner")}
              </div>
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                onMouseDown={(e) => handleResizeStart("owner", e)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Modified */}
            <div
              className={`px-3 py-2 font-mono flex-shrink-0 relative border-r border-border/20 cursor-pointer transition-colors ${colHeaderClass("modified")}`}
              style={{ width: columnWidths.modified }}
              onClick={(e) => { if (e.shiftKey) toggleCol("modified"); else handleSort("modified"); }}
            >
              <div className="flex items-center gap-1">
                <span>Modified</span>
                {getSortIcon("modified")}
              </div>
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                onMouseDown={(e) => handleResizeStart("modified", e)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Accessed */}
            <div
              className={`px-3 py-2 font-mono flex-shrink-0 relative cursor-pointer transition-colors ${colHeaderClass("accessed")}`}
              style={{ width: columnWidths.accessed }}
              onClick={(e) => { if (e.shiftKey) toggleCol("accessed"); else handleSort("accessed"); }}
            >
              <div className="flex items-center gap-1">
                <span>Accessed</span>
                {getSortIcon("accessed")}
              </div>
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
                onMouseDown={(e) => handleResizeStart("accessed", e)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        </div>

        {/* Results with vertical scrolling - fixed column widths */}
        <div className="divide-y divide-border/30 bg-background max-h-[500px] overflow-y-auto">
          {displayResults.map((entry, idx) => {
            const filename = extractFilename(entry.path);
            return (
              <div
                key={`${entry.path}-${idx}`}
                className={`flex items-center text-xs cursor-pointer transition-colors ${
                  highlightedRows.has(idx) ? "bg-primary/10" : "hover:bg-muted/5"
                }`}
                onClick={() => toggleRow(idx)}
              >
                <div
                  className={`px-3 py-2 font-mono flex-shrink-0 truncate border-r border-border/10 ${cellClass("filename", idx) || "text-foreground"}`}
                  style={{ width: columnWidths.filename }}
                  title={filename}
                >
                  {filename}
                </div>
                <div
                  className={`px-3 py-2 font-mono flex-shrink-0 truncate border-r border-border/10 ${cellClass("parent_dir", idx) || "text-muted-foreground"}`}
                  style={{ width: columnWidths.parent_dir }}
                  title={entry.parent_dir}
                >
                  {entry.parent_dir}
                </div>
                <div
                  className={`px-3 py-2 font-mono flex-shrink-0 truncate border-r border-border/10 ${cellClass("top_level_dir", idx) || "text-muted-foreground"}`}
                  style={{ width: columnWidths.top_level_dir }}
                  title={entry.top_level_dir}
                >
                  {entry.top_level_dir}
                </div>
                <div
                  className={`px-3 py-2 font-mono flex-shrink-0 truncate border-r border-border/10 ${cellClass("path", idx) || "text-muted-foreground"}`}
                  style={{ width: columnWidths.path }}
                  title={entry.path}
                >
                  {entry.path}
                </div>
                <div
                  className={`px-3 py-2 font-mono text-right flex-shrink-0 border-r border-border/10 ${cellClass("size", idx) || "text-muted-foreground"}`}
                  style={{ width: columnWidths.size }}
                >
                  {formatReadableSize(entry.size)}
                </div>
                <div
                  className={`px-3 py-2 font-mono flex-shrink-0 truncate border-r border-border/10 ${cellClass("owner", idx) || "text-muted-foreground"}`}
                  style={{ width: columnWidths.owner }}
                  title={entry.owner || "-"}
                >
                  {entry.owner || "-"}
                </div>
                <div
                  className={`px-3 py-2 font-mono flex-shrink-0 border-r border-border/10 ${cellClass("modified", idx) || "text-muted-foreground"}`}
                  style={{ width: columnWidths.modified }}
                >
                  {formatTimestamp(entry.modified_time)}
                </div>
                <div
                  className={`px-3 py-2 font-mono flex-shrink-0 ${cellClass("accessed", idx) || "text-muted-foreground"}`}
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

      {/* Aggregation Panel */}
      {viewMode === "table" && aggregations.length > 0 && (
        <div className="border-t border-border/30 mt-4">
          <div className="bg-muted/10 px-3 py-2 border-b border-border/30">
            <div className="text-[10px] font-mono font-semibold uppercase tracking-wide text-muted-foreground/70">
              Summary (Grouped by {aggGroupBy.join(", ")})
            </div>
          </div>
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs font-mono">
              <thead className="bg-background border-b border-border/30 sticky top-0 z-10">
                <tr>
                  {aggGroupBy.map(field => (
                    <th key={field} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {field.replace("_", " ")}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Count</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Total Size</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Avg Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {aggregations.map((row, idx) => (
                  <tr key={idx} className="hover:bg-muted/5 transition-colors">
                    {aggGroupBy.map(field => (
                      <td key={field} className="px-3 py-2 text-muted-foreground">
                        {row.keys[field] || "-"}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right text-muted-foreground">{row.count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatReadableSize(row.totalSize)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{formatReadableSize(row.avgSize)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
