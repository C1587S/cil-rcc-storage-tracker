export interface Snapshot {
  snapshot_date: string;
  total_entries: number;
  total_size: number;
  total_files: number;
  total_directories: number;
  scan_started?: string;
  scan_completed?: string;
  top_level_dirs: string[];
  import_time?: string;
}

export interface DirectoryEntry {
  path: string;
  name: string;
  is_directory: boolean;
  size: number;
  size_formatted?: string;
  owner?: string;
  file_type?: string;
  modified_time?: number;
  accessed_time?: number;
  file_count?: number;
}

export interface BrowseResponse {
  snapshot_date: string;
  parent_path: string;
  folders: DirectoryEntry[];
  total_count: number;
}

export interface ContentsResponse {
  snapshot_date: string;
  parent_path: string;
  entries: DirectoryEntry[];
  total_count: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

export interface SearchResponse {
  snapshot_date: string;
  query: string;
  mode: "exact" | "contains" | "prefix" | "suffix";
  results: DirectoryEntry[];
  total_count: number;
  limit: number;
}

export interface QueryResponse {
  snapshot_date: string;
  sql: string;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  execution_time_ms: number;
}
