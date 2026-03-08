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
  size: number;  // Direct size (for files: file size, for dirs: sum of direct children)
  size_formatted?: string;
  recursive_size?: number;  // Recursive subtree total (dirs only)
  recursive_size_formatted?: string;
  owner?: string;
  file_type?: string;
  modified_time?: number;
  accessed_time?: number;
  file_count?: number;  // Direct children count
  dir_count?: number;  // Recursive subdirectories count
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

export interface NLToSQLResponse {
  question: string;
  sql: string;
  snapshot_date: string;
}

// Computing monitoring types

export interface ComputingReportMeta {
  published_at: string;
  published_by: string;
  report_id: string;
  schema_version: string;
}

export interface SUByUser {
  user: string;
  consumed: number;
}

export interface SUByPartition {
  partition: string;
  consumed: number;
}

export interface BurnRate {
  sus_per_day_avg: number | null;
  projected_total: number | null;
  projected_surplus: number | null;
}

export interface ServiceUnits {
  allocated: number | null;
  consumed: number | null;
  remaining: number | null;
  period_end: string | null;
  days_left: number | null;
  burn_rate: BurnRate;
  by_user: SUByUser[];
  by_partition: SUByPartition[];
}

export interface JobEntry {
  job_id: string;
  user: string;
  name: string;
  state: string;
  partition: string;
  cpus: number;
  mem_alloc: string;
  elapsed: string;
  time_limit: string;
  time_left: string;
  node: string;
  reason: string;
}

export interface JobsByUser {
  user: string;
  running: number;
  pending: number;
  total: number;
  total_cpus: number;
  total_mem_alloc_gb: number;
  by_partition: { partition: string; running: number; pending: number }[];
}

export interface Jobs {
  running: number;
  pending: number;
  total: number;
  by_user: JobsByUser[];
  list: JobEntry[];
}

export interface PartitionNodeUser {
  user: string;
  jobs: number;
  cpus: number;
  mem_alloc_gb: number;
  elapsed: string;
}

export interface PartitionNode {
  name: string;
  state: string;
  cpus_allocated: number;
  cpus_total: number;
  cpu_pct: number;
  mem_used_gb: number;
  mem_total_gb: number;
  mem_pct: number;
  users: PartitionNodeUser[];
}

export interface PartitionUserResource {
  user: string;
  jobs_running: number;
  jobs_pending: number;
  cpus: number;
  mem_alloc_gb: number;
  nodes: string[];
  longest_elapsed: string;
  max_time_limit: string;
  shortest_time_left: string;
}

export interface PartitionData {
  is_private: boolean;
  totals: {
    nodes_total: number;
    nodes_idle: number;
    nodes_mixed: number;
    nodes_allocated: number;
    nodes_down: number;
    cpus_allocated: number;
    cpus_total: number;
    cpu_pct: number;
    mem_used_gb: number;
    mem_total_gb: number;
    mem_pct: number;
  };
  nodes: PartitionNode[];
  sessions: JobEntry[];
  user_resources: PartitionUserResource[];
}

export interface QuotaFilesystem {
  filesystem: string;
  type: string;
  space_used_gb: number | null;
  space_limit_gb: number | null;
  space_pct: number | null;
  files_used: number | null;
  files_limit: number | null;
  files_pct: number | null;
}

export interface ClusterScan {
  meta: {
    timestamp: string;
    cluster: string;
    hostname: string;
    account: string;
    scan_version: string;
    scan_duration_sec: number;
  };
  service_units: ServiceUnits;
  jobs: Jobs;
  partitions: Record<string, PartitionData>;
  quota: { filesystems: QuotaFilesystem[] } | null;
  errors: unknown[];
}

export interface ComputingReport {
  report_meta: ComputingReportMeta;
  group_members?: string[];
  clusters: {
    midway2: ClusterScan | null;
    midway3: ClusterScan | null;
  };
  combined: {
    service_units: {
      allocated: number | null;
      consumed: number | null;
      remaining: number | null;
      period_end: string | null;
      days_left: number | null;
      burn_rate_per_day: number | null;
    };
    jobs_total: {
      running: number;
      pending: number;
      total: number;
    };
  };
}
