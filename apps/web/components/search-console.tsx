"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  Search,
  Database,
  Code,
  FileText,
  HardDrive,
  FolderTree,
  AlertCircle,
  Sparkles,
  Download,
  Copy
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import { search, executeQuery } from "@/lib/api";
import { SearchResultsTable } from "@/components/search-results-table";
import type { QueryResponse } from "@/lib/types";

type ConsoleMode = "filters" | "guided" | "sql";
type SearchMode = "contains" | "exact" | "prefix" | "suffix";

interface FilterState {
  searchText: string;
  searchMode: SearchMode;
  scopeMode: "all" | "custom";
  customPath: string;
  includeFiles: boolean;
  includeDirs: boolean;
  limit: number;
}

const INITIAL_FILTERS: FilterState = {
  searchText: "",
  searchMode: "contains",
  scopeMode: "all",
  customPath: "",
  includeFiles: true,
  includeDirs: true,
  limit: 100,
};

interface ExamplePreset {
  id: string;
  category: "code" | "data" | "storage" | "directories";
  icon: React.ReactNode;
  title: string;
  description: string;
  filters: Partial<FilterState>;
}

const EXAMPLE_PRESETS: ExamplePreset[] = [
  // Code Analysis
  {
    id: "python-transform",
    category: "code",
    icon: <Code className="h-4 w-4 text-blue-400" />,
    title: "Python files with 'transform'",
    description: "Find .py files containing 'transform' in /project/cil (semantic code search)",
    filters: {
      searchText: "transform.py",
      searchMode: "contains",
      includeFiles: true,
      includeDirs: false,
      scopeMode: "custom",
      customPath: "/project/cil",
      limit: 100,
    },
  },

  // Data Workflows
  {
    id: "weights-csv",
    category: "data",
    icon: <FileText className="h-4 w-4 text-green-400" />,
    title: "CSV files with 'weight'",
    description: "Data files containing 'weight' in name (realistic data exploration)",
    filters: {
      searchText: "weight",
      searchMode: "contains",
      includeFiles: true,
      includeDirs: false,
      scopeMode: "custom",
      customPath: "/project/cil",
      limit: 100,
    },
  },

  // Storage Triage
  {
    id: "largest-gcp",
    category: "storage",
    icon: <Sparkles className="h-4 w-4 text-orange-400" />,
    title: "Largest files in /gcp",
    description: "Top 50 largest files in /project/cil/gcp (storage cleanup workflow)",
    filters: {
      searchText: ".",
      searchMode: "contains",
      includeFiles: true,
      includeDirs: false,
      scopeMode: "custom",
      customPath: "/project/cil/gcp",
      limit: 50,
    },
  },
  {
    id: "log-files-storage",
    category: "storage",
    icon: <FileText className="h-4 w-4 text-yellow-400" />,
    title: "Log files (cleanup candidate)",
    description: "Find .log files for potential cleanup",
    filters: {
      searchText: ".log",
      searchMode: "suffix",
      includeFiles: true,
      includeDirs: false,
      scopeMode: "custom",
      customPath: "/project/cil",
      limit: 100,
    },
  },

  // Directory Discovery
  {
    id: "stations-dirs",
    category: "directories",
    icon: <FolderTree className="h-4 w-4 text-indigo-400" />,
    title: "Folders with 'stations'",
    description: "Discover directories containing 'stations' (folder-level search)",
    filters: {
      searchText: "stations",
      searchMode: "contains",
      includeFiles: false,
      includeDirs: true,
      scopeMode: "custom",
      customPath: "/project/cil",
      limit: 50,
    },
  },
  {
    id: "outputs-dirs",
    category: "directories",
    icon: <FolderTree className="h-4 w-4 text-pink-400" />,
    title: "Output directories",
    description: "Find all 'outputs' or 'output' folders",
    filters: {
      searchText: "output",
      searchMode: "contains",
      includeFiles: false,
      includeDirs: true,
      scopeMode: "custom",
      customPath: "/project/cil",
      limit: 50,
    },
  },
];

// Helper function to generate SQL from filters
function generateSQLFromFilters(filters: FilterState, snapshotDate: string): string {
  let nameCondition = "";

  if (filters.searchMode === "exact") {
    nameCondition = `name = '${filters.searchText}'`;
  } else if (filters.searchMode === "contains") {
    nameCondition = `positionCaseInsensitive(name, '${filters.searchText}') > 0`;
  } else if (filters.searchMode === "prefix") {
    nameCondition = `startsWith(name, '${filters.searchText}')`;
  } else if (filters.searchMode === "suffix") {
    nameCondition = `endsWith(name, '${filters.searchText}')`;
  }

  let typeCondition = "";
  if (!filters.includeFiles && filters.includeDirs) {
    typeCondition = "is_directory = 1";
  } else if (filters.includeFiles && !filters.includeDirs) {
    typeCondition = "is_directory = 0";
  }

  let pathCondition = "";
  if (filters.scopeMode === "custom" && filters.customPath.trim()) {
    pathCondition = `path LIKE '${filters.customPath}/%'`;
  }

  const conditions = [
    `snapshot_date = '${snapshotDate}'`,
    nameCondition,
    typeCondition,
    pathCondition,
  ].filter(c => c);

  return `SELECT
  path,
  name,
  formatReadableSize(size) AS size,
  owner,
  toDateTime(modified_time) AS modified,
  toDateTime(accessed_time) AS accessed
FROM filesystem.entries
WHERE ${conditions.join("\n  AND ")}
ORDER BY size DESC
LIMIT ${filters.limit};`;
}

// SQL Templates for Guided Mode
interface SQLTemplate {
  id: string;
  name: string;
  description: string;
  category: "files" | "directories" | "storage" | "hygiene";
  params: { name: string; label: string; type: "text" | "number"; default: any; placeholder?: string }[];
  generateSQL: (params: Record<string, any>) => string;
}

const SQL_TEMPLATES: SQLTemplate[] = [
  {
    id: "largest-files-in-dir",
    name: "Top N largest files in directory",
    description: "Find the largest files under a specific path",
    category: "files",
    params: [
      { name: "path", label: "Directory Path", type: "text", default: "/project/cil/gcp", placeholder: "/project/cil/gcp" },
      { name: "limit", label: "Limit", type: "number", default: 15 },
    ],
    generateSQL: (params) => `SELECT
  path,
  name,
  formatReadableSize(size) AS size,
  owner,
  toDateTime(modified_time) AS modified
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND path LIKE concat('${params.path}', '/%')
  AND is_directory = 0
ORDER BY size DESC
LIMIT ${params.limit}`,
  },
  {
    id: "files-not-accessed",
    name: "Files not accessed in N days",
    description: "Find stale files that haven't been accessed recently",
    category: "storage",
    params: [
      { name: "path", label: "Directory Path", type: "text", default: "/project/cil", placeholder: "/project/cil" },
      { name: "days", label: "Days", type: "number", default: 180 },
      { name: "limit", label: "Limit", type: "number", default: 100 },
    ],
    generateSQL: (params) => `SELECT
  path,
  name,
  formatReadableSize(size) AS size,
  owner,
  toDateTime(accessed_time) AS last_accessed,
  dateDiff('day', toDateTime(accessed_time), now()) AS days_since_access
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND path LIKE concat('${params.path}', '/%')
  AND is_directory = 0
  AND accessed_time < toUnixTimestamp(now() - INTERVAL ${params.days} DAY)
ORDER BY size DESC
LIMIT ${params.limit}`,
  },
  {
    id: "dirs-with-most-empty-files",
    name: "Directories with most empty files",
    description: "Find directories containing many empty (0-byte) files",
    category: "hygiene",
    params: [
      { name: "path", label: "Scope Path", type: "text", default: "/project/cil", placeholder: "/project/cil" },
      { name: "limit", label: "Limit", type: "number", default: 20 },
    ],
    generateSQL: (params) => `SELECT
  parent_path,
  count() AS empty_file_count,
  formatReadableSize(sum(size)) AS total_size
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND path LIKE concat('${params.path}', '/%')
  AND is_directory = 0
  AND size = 0
GROUP BY parent_path
ORDER BY empty_file_count DESC
LIMIT ${params.limit}`,
  },
  {
    id: "total-empty-files",
    name: "Total empty files audit",
    description: "Count all empty (0-byte) files across the project",
    category: "hygiene",
    params: [
      { name: "path", label: "Scope Path", type: "text", default: "/project/cil", placeholder: "/project/cil" },
    ],
    generateSQL: (params) => `SELECT
  count() AS total_empty_files,
  formatReadableSize(sum(size)) AS total_size
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND path LIKE concat('${params.path}', '/%')
  AND is_directory = 0
  AND size = 0`,
  },
  {
    id: "size-by-top-level-dir",
    name: "File count and size by top-level directory",
    description: "Group files by top-level directory (e.g., gcp, battuta-shares)",
    category: "directories",
    params: [
      { name: "limit", label: "Limit", type: "number", default: 10 },
    ],
    generateSQL: (params) => `SELECT
  splitByChar('/', path)[3] AS top_level_dir,
  count() AS file_count,
  formatReadableSize(sum(size)) AS total_size
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND is_directory = 0
  AND length(splitByChar('/', path)) >= 4
GROUP BY top_level_dir
ORDER BY sum(size) DESC
LIMIT ${params.limit}`,
  },
  {
    id: "file-type-breakdown",
    name: "File type breakdown in directory",
    description: "Count files by extension/type (.zarr, .csv, .py, etc.)",
    category: "files",
    params: [
      { name: "path", label: "Directory Path", type: "text", default: "/project/cil/sacagawea_shares", placeholder: "/project/cil/sacagawea_shares" },
      { name: "limit", label: "Limit", type: "number", default: 20 },
    ],
    generateSQL: (params) => `SELECT
  file_type,
  count() AS file_count,
  formatReadableSize(sum(size)) AS total_size
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND path LIKE concat('${params.path}', '/%')
  AND is_directory = 0
  AND file_type != ''
GROUP BY file_type
ORDER BY sum(size) DESC
LIMIT ${params.limit}`,
  },
  {
    id: "shapefile-outputs-gcp",
    name: "Top shapefile outputs in /gcp",
    description: "Top 15 largest shapefile-related files under /project/cil/gcp",
    category: "files",
    params: [
      { name: "limit", label: "Limit", type: "number", default: 15 },
    ],
    generateSQL: (params) => `SELECT
  path,
  name,
  formatReadableSize(size) AS size,
  owner,
  toDateTime(modified_time) AS modified
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND path LIKE concat('/project/cil/gcp', '/%')
  AND is_directory = 0
  AND (name LIKE concat('%.shp', '%') OR name LIKE concat('%shapefile', '%') OR parent_path LIKE concat('%output', '%'))
ORDER BY size DESC
LIMIT ${params.limit}`,
  },
];

// Guided SQL Mode Component
function GuidedSQLMode({
  selectedSnapshot,
  onAddToReport,
}: {
  selectedSnapshot: string | null;
  onAddToReport: (entry: Omit<ReportEntry, "id" | "timestamp">) => void;
}) {
  const [selectedTemplate, setSelectedTemplate] = useState<SQLTemplate | null>(null);
  const [templateParams, setTemplateParams] = useState<Record<string, any>>({});
  const [generatedSQL, setGeneratedSQL] = useState("");
  const [hasExecuted, setHasExecuted] = useState(false);

  // Update params when template changes
  useEffect(() => {
    if (selectedTemplate) {
      const defaultParams: Record<string, any> = {};
      selectedTemplate.params.forEach(param => {
        defaultParams[param.name] = param.default;
      });
      setTemplateParams(defaultParams);

      if (selectedSnapshot) {
        const sql = selectedTemplate.generateSQL(defaultParams);
        setGeneratedSQL(sql);
      }
    }
  }, [selectedTemplate, selectedSnapshot]);

  // Regenerate SQL when params change
  const handleParamChange = (paramName: string, value: any) => {
    const updated = { ...templateParams, [paramName]: value };
    setTemplateParams(updated);

    if (selectedTemplate && selectedSnapshot) {
      const sql = selectedTemplate.generateSQL(updated);
      setGeneratedSQL(sql);
    }
  };

  const { data: queryResult, isLoading, error } = useQuery({
    queryKey: ["guided-sql", selectedSnapshot, generatedSQL, hasExecuted],
    queryFn: async () => {
      if (!selectedSnapshot) throw new Error("No snapshot selected");

      // Sanitize SQL: remove trailing semicolons and trim whitespace
      const sanitizedSQL = generatedSQL.trim().replace(/;+\s*$/, '');

      // DEBUG: Log exact SQL being sent to backend
      console.log('=== GUIDED SQL DEBUG ===');
      console.log('Original SQL:', generatedSQL);
      console.log('Sanitized SQL:', sanitizedSQL);
      console.log('SQL length:', sanitizedSQL.length);
      console.log('Contains semicolon:', sanitizedSQL.includes(';'));
      console.log('Statement count:', sanitizedSQL.split(';').filter(s => s.trim()).length);
      console.log('Exact payload:', {
        snapshot_date: selectedSnapshot,
        sql: sanitizedSQL,
        limit: 5000,
      });

      return executeQuery({
        snapshot_date: selectedSnapshot,
        sql: sanitizedSQL,
        limit: 5000,
      });
    },
    enabled: hasExecuted && !!selectedSnapshot && !!generatedSQL,
    retry: false,
  });

  const handleCopySQL = () => {
    navigator.clipboard.writeText(generatedSQL);
  };

  const templatesByCategory = {
    files: SQL_TEMPLATES.filter(t => t.category === "files"),
    directories: SQL_TEMPLATES.filter(t => t.category === "directories"),
    storage: SQL_TEMPLATES.filter(t => t.category === "storage"),
    hygiene: SQL_TEMPLATES.filter(t => t.category === "hygiene"),
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground mb-2">
        Select a query template, adjust parameters, and execute. snapshot_date is auto-injected.
      </div>

      {/* Template Selector */}
      <div className="border border-border/50 rounded-sm bg-muted/5">
        <div className="bg-muted/10 border-b border-border/50 px-3 py-2">
          <div className="text-[10px] font-mono font-semibold uppercase tracking-wide text-muted-foreground/70">
            Query Templates
          </div>
        </div>
        <div className="p-3 space-y-3">
          {Object.entries(templatesByCategory).map(([category, templates]) => (
            <div key={category}>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {category}
              </div>
              <div className="grid grid-cols-1 gap-2">
                {templates.map(template => (
                  <button
                    key={template.id}
                    onClick={() => {
                      setSelectedTemplate(template);
                      setHasExecuted(false);
                    }}
                    className={`text-left p-2.5 border rounded-sm transition-colors ${
                      selectedTemplate?.id === template.id
                        ? "bg-primary/10 border-primary/30"
                        : "border-border/20 hover:bg-muted/10"
                    }`}
                  >
                    <div className="text-xs font-medium text-foreground">{template.name}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{template.description}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Template Parameters */}
      {selectedTemplate && selectedTemplate.params.length > 0 && (
        <div className="border border-border/30 rounded-sm">
          <div className="bg-muted/10 border-b border-border/30 px-3 py-2">
            <div className="text-[10px] font-mono font-semibold uppercase tracking-wide text-muted-foreground/70">
              Parameters
            </div>
          </div>
          <div className="p-3 grid grid-cols-2 gap-3">
            {selectedTemplate.params.map(param => (
              <div key={param.name}>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                  {param.label}
                </label>
                <input
                  type={param.type}
                  value={templateParams[param.name] ?? param.default}
                  onChange={(e) => handleParamChange(param.name, param.type === "number" ? parseInt(e.target.value) : e.target.value)}
                  placeholder={param.placeholder}
                  className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SQL Display */}
      {generatedSQL && (
        <div className="border border-border/30 rounded-sm bg-muted/5">
          <div className="bg-muted/10 border-b border-border/30 px-3 py-2 flex items-center justify-between">
            <div className="text-[10px] font-mono font-semibold uppercase tracking-wide text-muted-foreground/70">
              Generated SQL
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopySQL}
              className="h-6 px-2 text-[10px] font-mono"
            >
              Copy SQL
            </Button>
          </div>
          <pre className="p-3 text-[11px] font-mono text-foreground overflow-x-auto max-h-[300px] overflow-y-auto">
            {generatedSQL}
          </pre>
        </div>
      )}

      {/* DEBUG: Show exact SQL that will be sent to backend */}
      {generatedSQL && (
        <div className="border border-yellow-500/30 rounded-sm bg-yellow-500/5 p-3">
          <div className="text-[10px] font-mono font-semibold text-yellow-600 mb-2">
            🔍 DEBUG: SQL to be executed (after sanitization)
          </div>
          <pre className="text-[10px] font-mono text-foreground whitespace-pre-wrap break-all bg-black/20 p-2 rounded-sm border border-yellow-500/20">
            {generatedSQL.trim().replace(/;+\s*$/, '')}
          </pre>
          <div className="mt-2 text-[10px] text-muted-foreground space-y-1 font-mono">
            <div>Length: <span className="text-foreground">{generatedSQL.trim().replace(/;+\s*$/, '').length}</span> chars</div>
            <div>Has semicolon: <span className={generatedSQL.trim().replace(/;+\s*$/, '').includes(';') ? 'text-red-400 font-bold' : 'text-green-400'}>{generatedSQL.trim().replace(/;+\s*$/, '').includes(';') ? 'YES ⚠️' : 'NO ✓'}</span></div>
            <div>Statements: <span className={generatedSQL.trim().replace(/;+\s*$/, '').split(';').filter(s => s.trim()).length > 1 ? 'text-red-400 font-bold' : 'text-green-400'}>{generatedSQL.trim().replace(/;+\s*$/, '').split(';').filter(s => s.trim()).length}</span></div>
            <div className="text-[9px] text-yellow-600 mt-1">Check browser console for full debug output</div>
          </div>
        </div>
      )}

      {/* Execute Button */}
      {generatedSQL && (
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => setHasExecuted(true)}
            disabled={!selectedSnapshot || !generatedSQL}
            className="text-xs"
          >
            <Database className="h-3.5 w-3.5 mr-1.5" />
            Execute Query
          </Button>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-sm">
          <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="text-[10px] text-red-400 leading-relaxed font-mono">
            {error instanceof Error ? error.message : "Query execution failed"}
          </div>
        </div>
      )}

      {/* Results */}
      {hasExecuted && queryResult && (
        <div className="border-t border-border/20 pt-4">
          <QueryResultsTable
            result={queryResult}
            isLoading={isLoading}
            sql={generatedSQL}
            mode="guided"
            onAddToReport={onAddToReport}
          />
        </div>
      )}
    </div>
  );
}

// Example queries for Raw SQL mode
const EXAMPLE_RAW_QUERIES = [
  {
    id: "largest-gcp-files",
    name: "Largest files in /gcp",
    description: "Top 15 largest files under /project/cil/gcp",
    sql: `SELECT
  path,
  name,
  formatReadableSize(size) AS size,
  owner,
  toDateTime(modified_time) AS modified
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND path LIKE concat('/project/cil/gcp', '/%')
  AND is_directory = 0
ORDER BY size DESC
LIMIT 15`,
  },
  {
    id: "shapefile-outputs",
    name: "Shapefile-related outputs",
    description: "Find shapefile outputs in /gcp (by size)",
    sql: `SELECT
  path,
  name,
  formatReadableSize(size) AS size,
  owner,
  toDateTime(modified_time) AS modified
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND path LIKE concat('/project/cil/gcp', '/%')
  AND is_directory = 0
  AND (name LIKE concat('%.shp', '%') OR name LIKE concat('%shapefile', '%') OR parent_path LIKE concat('%output', '%'))
ORDER BY size DESC
LIMIT 15`,
  },
  {
    id: "dirs-with-empty-files",
    name: "Directories with empty files",
    description: "Directories containing the most 0-byte files",
    sql: `SELECT
  parent_path,
  count() AS empty_file_count,
  formatReadableSize(sum(size)) AS total_size
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND path LIKE concat('/project/cil', '/%')
  AND is_directory = 0
  AND size = 0
GROUP BY parent_path
ORDER BY empty_file_count DESC
LIMIT 20`,
  },
  {
    id: "file-type-breakdown",
    name: "File type breakdown",
    description: "Count files by extension in a directory",
    sql: `SELECT
  file_type,
  count() AS file_count,
  formatReadableSize(sum(size)) AS total_size
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND path LIKE concat('/project/cil/gcp', '/%')
  AND is_directory = 0
  AND file_type != ''
GROUP BY file_type
ORDER BY sum(size) DESC
LIMIT 20`,
  },
];

// Raw SQL Mode Component
function RawSQLMode({
  selectedSnapshot,
  onAddToReport,
}: {
  selectedSnapshot: string | null;
  onAddToReport: (entry: Omit<ReportEntry, "id" | "timestamp">) => void;
}) {
  const [sql, setSQL] = useState("");
  const [limit, setLimit] = useState(100);
  const [hasExecuted, setHasExecuted] = useState(false);
  const [showExamples, setShowExamples] = useState(false);

  const { data: queryResult, isLoading, error } = useQuery({
    queryKey: ["raw-sql", selectedSnapshot, sql, limit, hasExecuted],
    queryFn: async () => {
      if (!selectedSnapshot) throw new Error("No snapshot selected");
      return executeQuery({
        snapshot_date: selectedSnapshot,
        sql: sql.trim(),
        limit,
      });
    },
    enabled: hasExecuted && !!selectedSnapshot && !!sql.trim(),
    retry: false,
  });

  const handleExecute = () => {
    if (!sql.trim()) return;
    setHasExecuted(true);
  };

  const loadExample = (exampleSQL: string) => {
    // Load the SQL template directly (snapshot_date is handled by backend)
    setSQL(exampleSQL);
    setHasExecuted(false);
    setShowExamples(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-sm">
        <AlertCircle className="h-3.5 w-3.5 text-yellow-400 mt-0.5 flex-shrink-0" />
        <div className="text-[10px] text-yellow-400 leading-relaxed">
          <strong>Advanced mode:</strong> Write raw SQL queries with strict backend guardrails.
          Only SELECT statements allowed. snapshot_date filter required. Max 5000 rows.
        </div>
      </div>

      {/* Example Queries */}
      <div className="border border-border/50 rounded-sm bg-muted/5">
        <button
          onClick={() => setShowExamples(!showExamples)}
          className="w-full flex items-center justify-between p-3 hover:bg-muted/10 transition-colors"
        >
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Example Queries
          </h4>
          {showExamples ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {showExamples && (
          <div className="px-3 pb-3 border-t border-border/50">
            <div className="grid grid-cols-1 gap-2 mt-3">
              {EXAMPLE_RAW_QUERIES.map((example) => (
                <button
                  key={example.id}
                  onClick={() => loadExample(example.sql)}
                  className="text-left p-2.5 border border-border/20 rounded-sm hover:bg-muted/10 hover:border-primary/30 transition-colors"
                >
                  <div className="text-xs font-medium text-foreground">{example.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{example.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SQL Editor */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
          SQL Query
        </label>
        <textarea
          value={sql}
          onChange={(e) => setSQL(e.target.value)}
          placeholder={`SELECT path, name, formatReadableSize(size) AS size, owner
FROM filesystem.entries
WHERE snapshot_date = %(snapshot_date)s
  AND path LIKE concat('/project/cil/gcp', '/%')
  AND is_directory = 0
ORDER BY size DESC
LIMIT 100`}
          className="w-full px-3 py-2 text-xs bg-background border border-border rounded-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 min-h-[200px] resize-y"
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mr-2">
              Max Rows:
            </label>
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
              className="px-3 py-1.5 text-xs bg-background border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
              <option value={5000}>5000</option>
            </select>
          </div>
        </div>

        <Button
          size="sm"
          onClick={handleExecute}
          disabled={!selectedSnapshot || !sql.trim()}
          className="text-xs"
        >
          <Code className="h-3.5 w-3.5 mr-1.5" />
          Execute Query
        </Button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-sm">
          <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="text-[10px] text-red-400 leading-relaxed font-mono whitespace-pre-wrap">
            {error instanceof Error ? error.message : "Query execution failed"}
          </div>
        </div>
      )}

      {/* Results */}
      {hasExecuted && queryResult && (
        <div className="border-t border-border/20 pt-4">
          <QueryResultsTable
            result={queryResult}
            isLoading={isLoading}
            sql={sql}
            mode="sql"
            onAddToReport={onAddToReport}
          />
        </div>
      )}

      {/* Help Text */}
      <div className="text-[10px] text-muted-foreground/70 space-y-1">
        <div><strong>Allowed:</strong> SELECT statements only</div>
        <div><strong>Required:</strong> snapshot_date filter in WHERE clause</div>
        <div><strong>Blocked:</strong> INSERT, UPDATE, DELETE, DROP, external functions, multiple statements</div>
        <div><strong>Tables:</strong> filesystem.entries, filesystem.directory_recursive_sizes</div>
      </div>
    </div>
  );
}

// Query Results Table Component
function QueryResultsTable({
  result,
  isLoading,
  sql,
  mode,
  onAddToReport,
}: {
  result: QueryResponse;
  isLoading: boolean;
  sql?: string;
  mode?: ConsoleMode;
  onAddToReport?: (entry: Omit<ReportEntry, "id" | "timestamp">) => void;
}) {
  const [showAggregation, setShowAggregation] = useState(false);
  const [aggGroupByColumns, setAggGroupByColumns] = useState<string[]>([]);

  if (isLoading) {
    return (
      <div className="border border-border/30 rounded-sm bg-muted/5">
        <div className="p-8 text-center text-xs text-muted-foreground font-mono">
          Executing query...
        </div>
      </div>
    );
  }

  const downloadCSV = () => {
    const csvContent = [
      result.columns.join(","),
      ...result.rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `query-results-${Date.now()}.csv`;
    link.click();
  };

  const downloadTXT = () => {
    // Calculate column widths
    const colWidths = result.columns.map((col, idx) => {
      const cellWidths = result.rows.map(row => String(row[idx] || "").length);
      return Math.max(col.length, ...cellWidths);
    });

    // Create header
    const header = result.columns.map((col, idx) => col.padEnd(colWidths[idx])).join(" | ");
    const separator = colWidths.map(w => "-".repeat(w)).join("-+-");

    // Create rows
    const rows = result.rows.map(row =>
      row.map((cell, idx) => String(cell || "").padEnd(colWidths[idx])).join(" | ")
    );

    const txtContent = [header, separator, ...rows].join("\n");

    const blob = new Blob([txtContent], { type: "text/plain;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `query-results-${Date.now()}.txt`;
    link.click();
  };

  const generateMarkdown = () => {
    const header = `| ${result.columns.join(" | ")} |`;
    const separator = `| ${result.columns.map(() => "---").join(" | ")} |`;
    const rows = result.rows.map(row => `| ${row.map(cell => String(cell || "")).join(" | ")} |`);
    return [header, separator, ...rows].join("\n");
  };

  const copyMarkdown = () => {
    navigator.clipboard.writeText(generateMarkdown());
  };

  // Build aggregations
  const aggregations = useMemo(() => {
    if (!showAggregation || aggGroupByColumns.length === 0) return [];

    // Find indices for grouping columns and numeric columns
    const groupByIndices = aggGroupByColumns.map(col => result.columns.indexOf(col)).filter(idx => idx !== -1);
    if (groupByIndices.length === 0) return [];

    // Find numeric columns (exclude formatted size strings)
    const numericColumnIndices = result.columns.map((col, idx) => {
      // Skip if it's a grouping column
      if (groupByIndices.includes(idx)) return -1;

      // Check if most values are numeric
      const sampleValues = result.rows.slice(0, Math.min(10, result.rows.length)).map(row => row[idx]);
      const numericCount = sampleValues.filter(v => typeof v === 'number' || !isNaN(Number(v))).length;
      return numericCount > sampleValues.length / 2 ? idx : -1;
    }).filter(idx => idx !== -1);

    // Group by selected columns
    const groups = new Map<string, { keys: Record<string, any>; count: number; sums: number[] }>();

    result.rows.forEach(row => {
      const key = groupByIndices.map(idx => String(row[idx] || "-")).join("|||");

      if (!groups.has(key)) {
        const keys: Record<string, any> = {};
        groupByIndices.forEach((idx, i) => {
          keys[aggGroupByColumns[i]] = row[idx] || "-";
        });
        groups.set(key, { keys, count: 0, sums: new Array(numericColumnIndices.length).fill(0) });
      }

      const group = groups.get(key)!;
      group.count++;

      // Sum numeric columns
      numericColumnIndices.forEach((colIdx, i) => {
        const value = row[colIdx];
        const numValue = typeof value === 'number' ? value : parseFloat(String(value));
        if (!isNaN(numValue)) {
          group.sums[i] += numValue;
        }
      });
    });

    return Array.from(groups.values()).map(group => ({
      keys: group.keys,
      count: group.count,
      numericSums: group.sums,
    }));
  }, [result, showAggregation, aggGroupByColumns]);

  // Get available grouping columns (text columns)
  const availableGroupByColumns = result.columns.filter((col, idx) => {
    // Check if column contains mostly text values
    const sampleValues = result.rows.slice(0, Math.min(10, result.rows.length)).map(row => row[idx]);
    const textCount = sampleValues.filter(v => typeof v === 'string' || (typeof v !== 'number' && isNaN(Number(v)))).length;
    return textCount > sampleValues.length / 2;
  });

  return (
    <div className="border border-border/50 rounded-sm overflow-hidden shadow-sm">
      {/* Header */}
      <div className="bg-muted/10 border-b border-border/50 px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-[10px] font-mono text-muted-foreground">
              {result.row_count} rows • {result.execution_time_ms}ms
            </div>

            {/* Aggregation Toggle */}
            {availableGroupByColumns.length > 0 && (
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
            {onAddToReport && sql && mode && (
              <Button
                variant="default"
                size="sm"
                onClick={() => onAddToReport({
                  mode,
                  sql,
                  columns: result.columns,
                  rows: result.rows,
                  rowCount: result.row_count,
                })}
                className="h-6 px-2 text-[10px] font-mono bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
              >
                <FileText className="h-3 w-3 mr-1" />
                Add to Report
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={downloadCSV}
              className="h-6 px-2 text-[10px] font-mono"
            >
              <Download className="h-3 w-3 mr-1" />
              CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={downloadTXT}
              className="h-6 px-2 text-[10px] font-mono"
            >
              <Download className="h-3 w-3 mr-1" />
              TXT
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={copyMarkdown}
              className="h-6 px-2 text-[10px] font-mono"
            >
              Copy MD
            </Button>
          </div>
        </div>

        {/* Aggregation Controls */}
        {showAggregation && availableGroupByColumns.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/20 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-muted-foreground font-mono">Group by:</span>
            <div className="flex gap-2 flex-wrap">
              {availableGroupByColumns.map(col => (
                <label key={col} className="flex items-center gap-1 text-[10px]">
                  <input
                    type="checkbox"
                    checked={aggGroupByColumns.includes(col)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setAggGroupByColumns([...aggGroupByColumns, col]);
                      } else {
                        setAggGroupByColumns(aggGroupByColumns.filter(c => c !== col));
                      }
                    }}
                    className="rounded border-border"
                  />
                  <span className="font-mono text-muted-foreground">{col}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted/10 border-b border-border/30 sticky top-0">
              <tr>
                {result.columns.map((col, idx) => (
                  <th
                    key={idx}
                    className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {result.rows.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-muted/5 transition-colors">
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx} className="px-3 py-2 text-muted-foreground">
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Aggregation Panel */}
      {aggregations.length > 0 && (
        <div className="border-t border-border/30 mt-4">
          <div className="bg-muted/10 px-3 py-2 border-b border-border/30">
            <div className="text-[10px] font-mono font-semibold uppercase tracking-wide text-muted-foreground/70">
              Summary (Grouped by {aggGroupByColumns.join(", ")})
            </div>
          </div>
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted/10 border-b border-border/30 sticky top-0">
                <tr>
                  {aggGroupByColumns.map(col => (
                    <th key={col} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {col}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {aggregations.map((row: any, idx: number) => (
                  <tr key={idx} className="hover:bg-muted/5 transition-colors">
                    {aggGroupByColumns.map(col => (
                      <td key={col} className="px-3 py-2 text-muted-foreground">
                        {row.keys[col] || "-"}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right text-muted-foreground">{row.count.toLocaleString()}</td>
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

// Report Builder types
interface ReportEntry {
  id: string;
  timestamp: Date;
  mode: ConsoleMode;
  sql: string;
  columns: string[];
  rows: any[][];
  rowCount: number;
}

// Report Panel Component
function ReportPanel({
  entries,
  onRemove,
  onDownload,
  isExpanded,
  onToggle,
}: {
  entries: ReportEntry[];
  onRemove: (id: string) => void;
  onDownload: () => void;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const reportDate = new Date().toISOString().split('T')[0];
  const reportName = `rcc_report_${reportDate}`;

  return (
    <div className="border-2 border-primary/40 rounded-sm bg-primary/5 mt-4 shadow-sm">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-primary/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-primary" />
          <h4 className="text-xs font-semibold text-primary uppercase tracking-wide">
            Report Builder: {reportName}
          </h4>
          <span className="text-[10px] text-primary/70 font-mono">({entries.length} queries)</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-primary" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-primary" />
        )}
      </button>

      {isExpanded && (
        <div className="border-t-2 border-primary/30 p-3">
          {entries.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              No queries added yet. Execute a query and click "Add to Report" to get started.
            </div>
          ) : (
            <>
              <div className="space-y-2 mb-3">
                {entries.map((entry, idx) => (
                  <div key={entry.id} className="flex items-start gap-2 p-2 bg-background/50 border border-border/20 rounded-sm">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-muted-foreground">Query {idx + 1}</span>
                        <span className="text-[9px] text-muted-foreground/70">{entry.timestamp.toLocaleTimeString()}</span>
                        <span className="text-[9px] text-primary/70 font-mono">{entry.mode}</span>
                      </div>
                      <div className="text-[10px] font-mono text-foreground mt-1 truncate">
                        {entry.sql.substring(0, 80)}...
                      </div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">
                        {entry.rowCount} rows
                      </div>
                    </div>
                    <button
                      onClick={() => onRemove(entry.id)}
                      className="text-red-400 hover:text-red-300 text-[10px] px-2 py-1"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <Button
                size="sm"
                onClick={onDownload}
                className="w-full text-xs"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Download Report ({reportName}.md)
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function SearchConsole() {
  const { selectedSnapshot } = useAppStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [mode, setMode] = useState<ConsoleMode>("filters");
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [hasSearched, setHasSearched] = useState(false);
  const [isExamplesExpanded, setIsExamplesExpanded] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Report Builder state
  const [reportEntries, setReportEntries] = useState<ReportEntry[]>([]);
  const [showReport, setShowReport] = useState(false);

  const addToReport = (entry: Omit<ReportEntry, "id" | "timestamp">) => {
    // Check if exact same query already exists
    const duplicate = reportEntries.find(e => e.sql === entry.sql);
    if (duplicate) {
      alert("This query is already in the report");
      return;
    }

    const newEntry: ReportEntry = {
      ...entry,
      id: `entry-${Date.now()}`,
      timestamp: new Date(),
    };

    setReportEntries([...reportEntries, newEntry]);
  };

  const removeFromReport = (id: string) => {
    setReportEntries(reportEntries.filter(e => e.id !== id));
  };

  const downloadReport = () => {
    const reportDate = new Date().toISOString().split('T')[0];
    const reportName = `rcc_report_${reportDate}`;

    // Generate markdown content
    let content = `# RCC Storage Report\n\n`;
    content += `**Snapshot:** ${selectedSnapshot}\n`;
    content += `**Generated:** ${new Date().toLocaleString()}\n`;
    content += `**Queries:** ${reportEntries.length}\n\n`;
    content += `---\n\n`;

    reportEntries.forEach((entry, idx) => {
      content += `## Query ${idx + 1} (${entry.mode})\n\n`;
      content += `**Executed:** ${entry.timestamp.toLocaleString()}\n\n`;
      content += `### SQL\n\n\`\`\`sql\n${entry.sql}\n\`\`\`\n\n`;
      content += `### Results (${entry.rowCount} rows)\n\n`;

      // Add markdown table
      const header = `| ${entry.columns.join(" | ")} |`;
      const separator = `| ${entry.columns.map(() => "---").join(" | ")} |`;
      const rows = entry.rows.slice(0, 100).map(row => `| ${row.map(cell => String(cell || "")).join(" | ")} |`);
      content += [header, separator, ...rows].join("\n");

      if (entry.rowCount > 100) {
        content += `\n\n_Showing first 100 of ${entry.rowCount} rows_\n`;
      }

      content += `\n\n---\n\n`;
    });

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${reportName}.md`;
    link.click();
  };

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const applyPreset = (preset: ExamplePreset) => {
    setFilters({ ...INITIAL_FILTERS, ...preset.filters });
    setHasSearched(false);
    setSearchError(null);
  };

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
    setHasSearched(false);
    setSearchError(null);
  };

  const handleSearch = () => {
    if (!selectedSnapshot) return;

    // Validate: q cannot be empty (backend requires min_length=1)
    if (!filters.searchText.trim()) {
      setSearchError("Search text is required. Backend requires at least 1 character.");
      return;
    }

    setSearchError(null);
    setHasSearched(true);
  };

  // Build search query from filters
  const buildSearchParams = () => {
    const params: Parameters<typeof search>[0] = {
      snapshot_date: selectedSnapshot!,
      q: filters.searchText.trim(),
      mode: filters.searchMode,
      include_files: filters.includeFiles,
      include_dirs: filters.includeDirs,
      limit: filters.limit,
    };

    // Path scope
    if (filters.scopeMode === "custom" && filters.customPath.trim()) {
      params.scope_path = filters.customPath.trim();
    }

    return params;
  };

  // Execute search query
  const { data: searchResults, isLoading: isSearching, error: queryError } = useQuery({
    queryKey: ["search", selectedSnapshot, filters, hasSearched],
    queryFn: () => search(buildSearchParams()),
    enabled: hasSearched && !!selectedSnapshot && !!filters.searchText.trim(),
    retry: false,
  });

  // Group presets by category
  const presetsByCategory = {
    "code": EXAMPLE_PRESETS.filter((p) => p.category === "code"),
    "data": EXAMPLE_PRESETS.filter((p) => p.category === "data"),
    "storage": EXAMPLE_PRESETS.filter((p) => p.category === "storage"),
    "directories": EXAMPLE_PRESETS.filter((p) => p.category === "directories"),
  };

  return (
    <Card className="border-t-2 border-border/50">
      <CardHeader
        className="cursor-pointer hover:bg-muted/5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-muted-foreground">
            Search & Query Console
          </CardTitle>
          <Button variant="ghost" size="sm">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Mode tabs */}
          <div className="flex items-center gap-2 border-b border-border/30 pb-3">
            <button
              onClick={() => setMode("filters")}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded-sm transition-colors",
                mode === "filters"
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:bg-muted/20"
              )}
            >
              <Search className="h-3.5 w-3.5" />
              Filter Builder
            </button>
            <button
              onClick={() => setMode("guided")}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded-sm transition-colors",
                mode === "guided"
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:bg-muted/20"
              )}
            >
              <Database className="h-3.5 w-3.5" />
              Guided SQL
            </button>
            <button
              onClick={() => setMode("sql")}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded-sm transition-colors",
                mode === "sql"
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:bg-muted/20"
              )}
            >
              <Code className="h-3.5 w-3.5" />
              Raw SQL
            </button>
          </div>

          {/* Filter Builder Mode */}
          {mode === "filters" && (
            <div className="space-y-4">
              {/* Example Presets - Expandable */}
              <div className="border border-border/30 rounded-sm">
                <button
                  onClick={() => setIsExamplesExpanded(!isExamplesExpanded)}
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/5 transition-colors"
                >
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Example Searches
                  </h4>
                  {isExamplesExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>

                {isExamplesExpanded && (
                  <div className="px-3 pb-3 space-y-3">
                    {/* Code Analysis */}
                    <div>
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                        Code Analysis
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {presetsByCategory["code"].map((preset) => (
                          <button
                            key={preset.id}
                            onClick={() => applyPreset(preset)}
                            className="flex items-start gap-2 p-2.5 bg-muted/5 hover:bg-muted/10 border border-border/20 rounded-sm transition-colors text-left"
                          >
                            <div className="mt-0.5">{preset.icon}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-foreground">
                                {preset.title}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {preset.description}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Data Workflows */}
                    <div>
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                        Data Workflows
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {presetsByCategory["data"].map((preset) => (
                          <button
                            key={preset.id}
                            onClick={() => applyPreset(preset)}
                            className="flex items-start gap-2 p-2.5 bg-muted/5 hover:bg-muted/10 border border-border/20 rounded-sm transition-colors text-left"
                          >
                            <div className="mt-0.5">{preset.icon}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-foreground">
                                {preset.title}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {preset.description}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Storage Triage */}
                    <div>
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                        Storage Triage
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {presetsByCategory["storage"].map((preset) => (
                          <button
                            key={preset.id}
                            onClick={() => applyPreset(preset)}
                            className="flex items-start gap-2 p-2.5 bg-muted/5 hover:bg-muted/10 border border-border/20 rounded-sm transition-colors text-left"
                          >
                            <div className="mt-0.5">{preset.icon}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-foreground">
                                {preset.title}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {preset.description}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Directory Discovery */}
                    <div>
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                        Directory Discovery
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {presetsByCategory["directories"].map((preset) => (
                          <button
                            key={preset.id}
                            onClick={() => applyPreset(preset)}
                            className="flex items-start gap-2 p-2.5 bg-muted/5 hover:bg-muted/10 border border-border/20 rounded-sm transition-colors text-left"
                          >
                            <div className="mt-0.5">{preset.icon}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-foreground">
                                {preset.title}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {preset.description}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Filter Form */}
              <div className="border-t border-border/20 pt-4 space-y-4">
                {/* Text Search - Required */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                    Search Text <span className="text-red-400">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={filters.searchText}
                      onChange={(e) => updateFilter("searchText", e.target.value)}
                      placeholder="Enter filename or pattern... (required)"
                      className="flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <select
                      value={filters.searchMode}
                      onChange={(e) => updateFilter("searchMode", e.target.value as SearchMode)}
                      className="px-3 py-1.5 text-xs bg-background border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                    >
                      <option value="contains">Contains</option>
                      <option value="exact">Exact</option>
                      <option value="prefix">Starts with</option>
                      <option value="suffix">Ends with</option>
                    </select>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground/60">
                    Searches match on filename only (not full path). Backend requires at least 1 character.
                  </div>
                </div>

                {/* Two-column layout for remaining filters */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Left column */}
                  <div className="space-y-3">
                    {/* Path Scope */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                        Path Scope
                      </label>
                      <select
                        value={filters.scopeMode}
                        onChange={(e) => updateFilter("scopeMode", e.target.value as "all" | "custom")}
                        className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                      >
                        <option value="all">All directories</option>
                        <option value="custom">Custom path...</option>
                      </select>
                      {filters.scopeMode === "custom" && (
                        <input
                          type="text"
                          value={filters.customPath}
                          onChange={(e) => updateFilter("customPath", e.target.value)}
                          placeholder="/project/cil/gcp/climate"
                          className="w-full mt-1.5 px-3 py-1.5 text-xs bg-background border border-border rounded-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                      )}
                      <div className="mt-1 text-[10px] text-muted-foreground/60">
                        Scoped searches are faster and more reliable
                      </div>
                    </div>

                    {/* Type Filter */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                        Type
                      </label>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={filters.includeFiles}
                            onChange={(e) => updateFilter("includeFiles", e.target.checked)}
                            className="rounded border-border"
                          />
                          <span>Files</span>
                        </label>
                        <label className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={filters.includeDirs}
                            onChange={(e) => updateFilter("includeDirs", e.target.checked)}
                            className="rounded border-border"
                          />
                          <span>Folders</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Right column */}
                  <div className="space-y-3">
                    {/* Result Limit */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                        Result Limit <span className="text-red-400">*</span>
                      </label>
                      <select
                        value={filters.limit}
                        onChange={(e) => updateFilter("limit", parseInt(e.target.value))}
                        className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                      >
                        <option value={50}>50 results</option>
                        <option value={100}>100 results</option>
                        <option value={500}>500 results</option>
                        <option value={1000}>1000 results</option>
                        <option value={5000}>5000 results (max)</option>
                      </select>
                      <div className="mt-1 text-[10px] text-muted-foreground/60">
                        Backend enforces maximum of 5000 rows
                      </div>
                    </div>
                  </div>
                </div>

                {/* Error Display */}
                {searchError && (
                  <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-sm">
                    <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                    <div className="text-[10px] text-red-400 leading-relaxed">
                      {searchError}
                    </div>
                  </div>
                )}

                {/* Query Error Display */}
                {queryError && (
                  <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-sm">
                    <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                    <div className="text-[10px] text-red-400 leading-relaxed font-mono">
                      {queryError instanceof Error ? queryError.message : "Search failed"}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center justify-between pt-2 border-t border-border/20">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetFilters}
                    className="text-xs"
                  >
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSearch}
                    disabled={!selectedSnapshot || !filters.searchText.trim()}
                    className="text-xs"
                  >
                    <Search className="h-3.5 w-3.5 mr-1.5" />
                    Search
                  </Button>
                </div>
              </div>

              {/* Results */}
              {hasSearched && !searchError && (
                <div className="border-t border-border/20 pt-4">
                  {isSearching ? (
                    <div className="flex items-center justify-center py-8 text-xs text-muted-foreground font-mono">
                      <div className="flex items-center gap-2">
                        <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                        <span>Searching...</span>
                      </div>
                    </div>
                  ) : (
                    <SearchResultsTable
                      results={searchResults?.results || []}
                      isLoading={isSearching}
                      totalCount={searchResults?.total_count || 0}
                      onAddToReport={addToReport}
                      searchFilters={filters}
                    />
                  )}
                </div>
              )}

              {/* Constraints Footnote */}
              <div className="flex items-start gap-2 p-3 bg-muted/5 border border-border/20 rounded-sm">
                <AlertCircle className="h-3.5 w-3.5 text-muted-foreground/70 mt-0.5 flex-shrink-0" />
                <div className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  <strong className="text-foreground/80">Backend constraints:</strong> Search text is required (min 1 character).
                  Results capped at 5000 rows. Searches match on filename only (not full path).
                  Scoped searches (custom path) are faster. See <span className="font-mono">clickhouse/docs/filesystem_queries.md</span> for query examples.
                </div>
              </div>
            </div>
          )}

          {/* Guided SQL Mode */}
          {mode === "guided" && (
            <GuidedSQLMode
              selectedSnapshot={selectedSnapshot}
              onAddToReport={addToReport}
            />
          )}

          {/* Raw SQL Mode */}
          {mode === "sql" && (
            <RawSQLMode
              selectedSnapshot={selectedSnapshot}
              onAddToReport={addToReport}
            />
          )}

          {/* Report Builder Panel */}
          <ReportPanel
            entries={reportEntries}
            onRemove={removeFromReport}
            onDownload={downloadReport}
            isExpanded={showReport}
            onToggle={() => setShowReport(!showReport)}
          />
        </CardContent>
      )}
    </Card>
  );
}
