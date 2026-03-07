"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { getComputingReport } from "@/lib/api";
import type {
  ComputingReport,
  JobEntry,
  QuotaFilesystem,
  PartitionNode,
  PartitionData,
} from "@/lib/types";
import {
  RefreshCw,
  Cpu,
  HardDrive,
  Users,
  Flame,
  Clock,
  Server,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────

function formatSU(n: number | null | undefined): string {
  if (n == null) return "--";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatGB(n: number | null | undefined): string {
  if (n == null) return "--";
  if (n >= 1024) return `${(n / 1024).toFixed(1)} TB`;
  return `${n.toFixed(1)} GB`;
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return "--";
  return `${n.toFixed(1)}%`;
}

function pctColor(pct: number | null | undefined): string {
  if (pct == null) return "text-muted-foreground";
  if (pct >= 90) return "text-red-500";
  if (pct >= 70) return "text-amber-500";
  return "text-emerald-500";
}

function pctBarColor(pct: number | null | undefined): string {
  if (pct == null) return "bg-muted";
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-primary";
}

function stateColor(state: string): string {
  switch (state.toUpperCase()) {
    case "RUNNING": return "text-emerald-500";
    case "PENDING": return "text-amber-500";
    case "IDLE": return "text-muted-foreground";
    case "MIXED": case "MIX": return "text-amber-500";
    case "ALLOCATED": case "ALLOC": return "text-primary";
    default: return "text-muted-foreground";
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Monitoring/accounting job name patterns to exclude
const MONITORING_JOB_PATTERNS = [
  "cil_computing_scan",
  "cil_computing_publish",
  "cil_daily_pipeline",
  "cil_daily_publish",
];

function isMonitoringJob(name: string): boolean {
  return MONITORING_JOB_PATTERNS.some(p => name === p || name.startsWith(p));
}

// User color palette — distinct, accessible colors
const USER_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#e11d48", // rose
  "#84cc16", // lime
];

function buildUserColorMap(nodes: PartitionNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    for (const u of node.users) {
      if (!map.has(u.user)) {
        map.set(u.user, USER_COLORS[map.size % USER_COLORS.length]);
      }
    }
  }
  return map;
}

// ─── Progress Bar ─────────────────────────────────────────────

function ProgressBar({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("h-2 rounded-full bg-secondary overflow-hidden", className)}>
      <div
        className={cn("h-full rounded-full transition-all", pctBarColor(value))}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// ─── Section Card ─────────────────────────────────────────────

function Section({ title, icon: Icon, children, className }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border border-border rounded-lg bg-card", className)}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Icon size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── SU Overview ──────────────────────────────────────────────

function SUOverview({ report }: { report: ComputingReport }) {
  const su = report.combined.service_units;
  const usedPct = su.allocated && su.consumed ? (su.consumed / su.allocated) * 100 : null;

  return (
    <Section title="Service Units" icon={Flame}>
      <div className="grid grid-cols-4 gap-6">
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Allocated</div>
          <div className="text-lg font-semibold">{formatSU(su.allocated)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Consumed</div>
          <div className="text-lg font-semibold text-amber-500">{formatSU(su.consumed)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Remaining</div>
          <div className="text-lg font-semibold text-emerald-500">{formatSU(su.remaining)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-1">Days Left</div>
          <div className={cn("text-lg font-semibold", su.days_left != null && su.days_left < 30 ? "text-red-500" : "")}>
            {su.days_left ?? "--"}
            {su.period_end && <span className="text-[10px] text-muted-foreground ml-1.5 font-normal">({su.period_end})</span>}
          </div>
        </div>
      </div>

      {usedPct != null && (
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
            <span>Usage</span>
            <span className={pctColor(usedPct)}>{formatPct(usedPct)}</span>
          </div>
          <ProgressBar value={usedPct} />
        </div>
      )}
    </Section>
  );
}

// ─── SU by User ───────────────────────────────────────────────

function SUByUserTable({ report }: { report: ComputingReport }) {
  const m3 = report.clusters.midway3;
  const users = m3?.service_units.by_user || [];
  const total = m3?.service_units.consumed || 1;

  if (users.length === 0) return null;

  return (
    <Section title="SU Usage by User" icon={Users}>
      <div className="space-y-2">
        {users.map((u) => {
          const pct = total > 0 ? (u.consumed / total) * 100 : 0;
          return (
            <div key={u.user} className="flex items-center gap-3">
              <span className="text-xs font-mono w-32 truncate">{u.user}</span>
              <div className="flex-1">
                <ProgressBar value={pct} />
              </div>
              <span className="text-xs text-muted-foreground w-24 text-right">{formatSU(u.consumed)}</span>
              <span className="text-[10px] text-muted-foreground w-12 text-right">{formatPct(pct)}</span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ─── Active Jobs ──────────────────────────────────────────────

function ActiveJobs({ report }: { report: ComputingReport }) {
  const allJobs: (JobEntry & { cluster: string })[] = [];
  for (const [name, cluster] of Object.entries(report.clusters)) {
    if (!cluster) continue;
    for (const job of cluster.jobs.list) {
      if (!isMonitoringJob(job.name)) {
        allJobs.push({ ...job, cluster: name });
      }
    }
  }

  const running = allJobs.filter(j => j.state === "RUNNING").length;
  const pending = allJobs.filter(j => j.state === "PENDING").length;

  return (
    <Section title="Active Jobs" icon={Cpu}>
      <div className="flex gap-4 mb-3 text-sm">
        <span>Running: <span className="font-medium text-emerald-500">{running}</span></span>
        <span>Pending: <span className="font-medium text-amber-500">{pending}</span></span>
        <span>Total: <span className="font-medium">{allJobs.length}</span></span>
      </div>

      {allJobs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="pb-2 pr-3 font-medium">User</th>
                <th className="pb-2 pr-3 font-medium">State</th>
                <th className="pb-2 pr-3 font-medium">Cluster</th>
                <th className="pb-2 pr-3 font-medium">Partition</th>
                <th className="pb-2 pr-3 font-medium">Job ID</th>
                <th className="pb-2 pr-3 font-medium">Name</th>
                <th className="pb-2 pr-3 font-medium">CPUs</th>
                <th className="pb-2 pr-3 font-medium">Mem</th>
                <th className="pb-2 pr-3 font-medium">Elapsed</th>
                <th className="pb-2 pr-3 font-medium">Limit</th>
                <th className="pb-2 font-medium">Left</th>
              </tr>
            </thead>
            <tbody>
              {allJobs.map((j) => (
                <tr key={`${j.cluster}-${j.job_id}`} className="border-t border-border/50">
                  <td className="py-1.5 pr-3 font-mono">{j.user}</td>
                  <td className={cn("py-1.5 pr-3 font-medium", stateColor(j.state))}>{j.state}</td>
                  <td className="py-1.5 pr-3">{j.cluster}</td>
                  <td className="py-1.5 pr-3">{j.partition}</td>
                  <td className="py-1.5 pr-3 font-mono">{j.job_id}</td>
                  <td className="py-1.5 pr-3 max-w-[150px] truncate">{j.name}</td>
                  <td className="py-1.5 pr-3">{j.cpus}</td>
                  <td className="py-1.5 pr-3">{j.mem_alloc}</td>
                  <td className="py-1.5 pr-3 font-mono">{j.elapsed}</td>
                  <td className="py-1.5 pr-3 font-mono">{j.time_limit}</td>
                  <td className="py-1.5 font-mono">{j.time_left}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allJobs.length === 0 && (
        <div className="text-sm text-muted-foreground">No active jobs.</div>
      )}
    </Section>
  );
}

// ─── Partition traffic-light (40/70 thresholds) ───────────────

function partitionPctColor(pct: number): string {
  if (pct >= 70) return "text-red-500";
  if (pct >= 40) return "text-amber-500";
  return "text-emerald-500";
}

function partitionPctBg(pct: number): string {
  if (pct >= 70) return "bg-red-500/10";
  if (pct >= 40) return "bg-amber-500/10";
  return "";
}

// ─── Build global user color map across all partitions ────────

function buildGlobalUserColorMap(
  partitions: { name: string; data: PartitionData }[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const { data } of partitions) {
    for (const node of data.nodes) {
      for (const u of node.users) {
        if (!map.has(u.user)) {
          map.set(u.user, USER_COLORS[map.size % USER_COLORS.length]);
        }
      }
    }
  }
  return map;
}

// ─── CPU Grid (8×8 solid squares) ─────────────────────────────

function CpuGrid({ node, userColorMap }: {
  node: PartitionNode;
  userColorMap: Map<string, string>;
}) {
  const totalCells = node.cpus_total;
  const cols = 8;
  const cells: { color: string; type: "user" | "free" }[] = [];

  for (const u of node.users) {
    const color = userColorMap.get(u.user) || "#888";
    for (let i = 0; i < u.cpus; i++) {
      cells.push({ color, type: "user" });
    }
  }
  while (cells.length < totalCells) {
    cells.push({ color: "", type: "free" });
  }

  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${cols}, 14px)`, gap: "2px" }}
    >
      {cells.map((cell, i) => (
        <div
          key={i}
          className={cn(
            "w-[14px] h-[14px] rounded-[2px]",
            cell.type === "free" && "bg-muted border border-border/40",
          )}
          style={cell.type === "user" ? { backgroundColor: cell.color } : undefined}
        />
      ))}
    </div>
  );
}

// ─── RAM Grid (16×16 squares with centered dots) ──────────────

function RamGrid({ node, userColorMap }: {
  node: PartitionNode;
  userColorMap: Map<string, string>;
}) {
  const totalCells = 256;
  const cols = 16;
  const reservedCells = totalCells - Math.round(node.mem_total_gb);
  const cells: { color: string; type: "reserved" | "user" | "free" }[] = [];

  for (let i = 0; i < reservedCells; i++) {
    cells.push({ color: "", type: "reserved" });
  }
  for (const u of node.users) {
    const color = userColorMap.get(u.user) || "#888";
    for (let i = 0; i < Math.round(u.mem_alloc_gb); i++) {
      cells.push({ color, type: "user" });
    }
  }
  while (cells.length < totalCells) {
    cells.push({ color: "", type: "free" });
  }

  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${cols}, 14px)`, gap: "2px" }}
    >
      {cells.map((cell, i) => (
        <div
          key={i}
          className={cn(
            "w-[14px] h-[14px] rounded-[2px] flex items-center justify-center",
            cell.type === "free" && "bg-muted",
            cell.type === "reserved" && "bg-border/20",
          )}
        >
          <div
            className={cn(
              "w-[6px] h-[6px] rounded-full",
              cell.type === "free" && "bg-border",
              cell.type === "reserved" && "bg-border/40",
            )}
            style={cell.type === "user" ? { backgroundColor: cell.color } : undefined}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Compact Grid Key ─────────────────────────────────────────

function GridKey() {
  return (
    <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <div className="w-[14px] h-[14px] rounded-[2px] bg-primary/60" />
        <span>= CPU core</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-[14px] h-[14px] rounded-[2px] bg-muted flex items-center justify-center">
          <div className="w-[6px] h-[6px] rounded-full bg-primary/60" />
        </div>
        <span>= 1 GB RAM</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-[14px] h-[14px] rounded-[2px] bg-muted border border-border/40" />
        <span>free</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-[14px] h-[14px] rounded-[2px] bg-border/20 flex items-center justify-center">
          <div className="w-[6px] h-[6px] rounded-full bg-border/40" />
        </div>
        <span>reserved</span>
      </div>
    </div>
  );
}

// ─── Consolidated User Table ──────────────────────────────────

function ConsolidatedUserTable({ partitions, userColorMap }: {
  partitions: { name: string; data: PartitionData }[];
  userColorMap: Map<string, string>;
}) {
  // Aggregate per-user resources across nodes for each partition
  const userPartitionData = useMemo(() => {
    const allUsers = new Set<string>();
    const partitionUsers: Map<string, Map<string, { cpus: number; mem: number }>> = new Map();

    for (const { name, data } of partitions) {
      const userMap = new Map<string, { cpus: number; mem: number }>();
      for (const node of data.nodes) {
        for (const u of node.users) {
          allUsers.add(u.user);
          const existing = userMap.get(u.user) || { cpus: 0, mem: 0 };
          existing.cpus += u.cpus;
          existing.mem += u.mem_alloc_gb;
          userMap.set(u.user, existing);
        }
      }
      partitionUsers.set(name, userMap);
    }

    return { allUsers: Array.from(allUsers).sort(), partitionUsers };
  }, [partitions]);

  if (userPartitionData.allUsers.length === 0) return null;

  return (
    <div className="overflow-x-auto mt-4 pt-4 border-t border-border">
      <table className="w-full text-xs">
        <thead>
          {/* Level 1: Partition names */}
          <tr className="text-muted-foreground text-left">
            <th className="pb-1 pr-3 font-medium" rowSpan={2}>User</th>
            {partitions.map(({ name, data }) => (
              <th key={name} className="pb-1 px-2 font-medium text-center border-l border-border/50" colSpan={4}>
                {name}
                <span className="ml-1.5 font-normal text-[10px]">
                  ({data.totals.cpus_total} CPU, {Math.round(data.totals.mem_total_gb)} GB)
                </span>
              </th>
            ))}
          </tr>
          {/* Level 2: CPU / RAM sub-headers */}
          <tr className="text-[10px] text-muted-foreground text-right">
            {partitions.map(({ name }) => (
              <React.Fragment key={name}>
                <th className="pb-1.5 px-2 font-medium border-l border-border/50">CPU</th>
                <th className="pb-1.5 px-2 font-medium">%</th>
                <th className="pb-1.5 px-2 font-medium">RAM</th>
                <th className="pb-1.5 px-2 font-medium">%</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {userPartitionData.allUsers.map((user) => (
            <tr key={user} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
              <td className="py-1.5 pr-3">
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                    style={{ backgroundColor: userColorMap.get(user) }}
                  />
                  <span className="font-mono text-xs">{user}</span>
                </div>
              </td>
              {partitions.map(({ name, data }) => {
                const usage = userPartitionData.partitionUsers.get(name)?.get(user);
                const cpuPct = usage ? (usage.cpus / data.totals.cpus_total) * 100 : 0;
                const memPct = usage ? (usage.mem / data.totals.mem_total_gb) * 100 : 0;

                return (
                  <React.Fragment key={name}>
                    <td className="py-1.5 px-2 text-right font-mono border-l border-border/50">
                      {usage ? usage.cpus : <span className="text-muted-foreground/40">--</span>}
                    </td>
                    <td className={cn("py-1.5 px-2 text-right font-mono", usage ? partitionPctColor(cpuPct) : "text-muted-foreground/40", usage && partitionPctBg(cpuPct))}>
                      {usage ? formatPct(cpuPct) : "--"}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">
                      {usage ? `${Math.round(usage.mem)} GB` : <span className="text-muted-foreground/40">--</span>}
                    </td>
                    <td className={cn("py-1.5 px-2 text-right font-mono", usage ? partitionPctColor(memPct) : "text-muted-foreground/40", usage && partitionPctBg(memPct))}>
                      {usage ? formatPct(memPct) : "--"}
                    </td>
                  </React.Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Partitions Section ───────────────────────────────────────

function PartitionsSection({ partitions }: {
  partitions: { name: string; data: PartitionData }[];
}) {
  const userColorMap = useMemo(() => buildGlobalUserColorMap(partitions), [partitions]);

  if (partitions.length === 0) return null;

  return (
    <Section title="Private Partitions" icon={Server}>
      {/* Partitions side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {partitions.map(({ name, data }) => {
          const t = data.totals;
          return (
            <div key={name}>
              {/* Partition header */}
              <div className="mb-2">
                <div className="text-xs font-medium">{name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {t.nodes_total} nodes -- {t.nodes_idle} idle, {t.nodes_mixed} mixed, {t.nodes_allocated} allocated
                  {t.nodes_down > 0 && `, ${t.nodes_down} down`}
                </div>
              </div>

              {/* Nodes — horizontal layout */}
              <div className="flex flex-wrap gap-6">
                {data.nodes.map((node: PartitionNode) => (
                  <div key={node.name}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[11px] font-mono font-medium">
                        {node.name.replace(/^midway\d+-/, "")}
                      </span>
                      <span className={cn("text-[10px]", stateColor(node.state))}>
                        {node.state}
                      </span>
                    </div>

                    {/* CPU + RAM stacked to keep node compact */}
                    <div className="space-y-2">
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1">
                          CPU -- {node.cpus_allocated}/{node.cpus_total} cores
                        </div>
                        <CpuGrid node={node} userColorMap={userColorMap} />
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1">
                          RAM -- {Math.round(node.mem_used_gb)}/{Math.round(node.mem_total_gb)} GB
                        </div>
                        <RamGrid node={node} userColorMap={userColorMap} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grid key */}
      <div className="mt-4 pt-3 border-t border-border">
        <GridKey />
      </div>

      {/* Consolidated user table */}
      <ConsolidatedUserTable partitions={partitions} userColorMap={userColorMap} />
    </Section>
  );
}

// ─── Quota ────────────────────────────────────────────────────

function QuotaSection({ report }: { report: ComputingReport }) {
  const seen = new Set<string>();
  const groupQuotas: (QuotaFilesystem & { cluster: string })[] = [];

  for (const clusterName of ["midway3", "midway2"] as const) {
    const cluster = report.clusters[clusterName];
    if (!cluster?.quota?.filesystems) continue;
    for (const fs of cluster.quota.filesystems) {
      // Only show group/project quotas — skip personal home/scratch
      if (fs.type !== "group") continue;
      const key = `${fs.filesystem}|${fs.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        groupQuotas.push({ ...fs, cluster: clusterName });
      }
    }
  }

  if (groupQuotas.length === 0) return null;

  return (
    <Section title="Storage Quota" icon={HardDrive}>
      {groupQuotas.map((q) => (
        <QuotaBar key={`${q.filesystem}-${q.type}`} quota={q} />
      ))}
    </Section>
  );
}

function QuotaBar({ quota: q }: { quota: QuotaFilesystem }) {
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium">{q.filesystem}</span>
        <span className="text-muted-foreground">
          {formatGB(q.space_used_gb)} / {formatGB(q.space_limit_gb)}
          {q.space_pct != null && <span className={cn("ml-2", pctColor(q.space_pct))}>{formatPct(q.space_pct)}</span>}
        </span>
      </div>
      <ProgressBar value={q.space_pct ?? 0} />
      {q.files_used != null && q.files_limit != null && (
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>Files</span>
          <span>
            {q.files_used.toLocaleString()} / {q.files_limit.toLocaleString()}
            {q.files_pct != null && <span className={cn("ml-2", pctColor(q.files_pct))}>{formatPct(q.files_pct)}</span>}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────

export function ComputingDashboard() {
  const [report, setReport] = useState<ComputingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchReport = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await getComputingReport();
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
    const interval = setInterval(() => fetchReport(true), 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchReport]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        <div className="loader-morph mr-3" />
        Loading computing report...
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-border rounded-lg bg-card p-6 text-center">
        <AlertTriangle className="mx-auto mb-2 text-amber-500" size={24} />
        <div className="text-sm text-foreground mb-1">Could not load computing data</div>
        <div className="text-xs text-muted-foreground mb-3">{error}</div>
        <button onClick={() => fetchReport()} className="text-xs text-primary hover:underline">Try again</button>
      </div>
    );
  }

  if (!report) return null;

  // Collect private partitions from all clusters
  const privatePartitions: { name: string; data: PartitionData }[] = [];
  for (const cluster of Object.values(report.clusters)) {
    if (!cluster) continue;
    for (const [pname, pdata] of Object.entries(cluster.partitions)) {
      if (pdata.is_private) {
        privatePartitions.push({ name: pname, data: pdata });
      }
    }
  }

  const publishedAt = report.report_meta.published_at;

  return (
    <div className="space-y-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Clock size={12} />
          Report: {timeAgo(publishedAt)}
          <span className="text-[10px]">({new Date(publishedAt).toLocaleString()})</span>
        </div>
        <button
          onClick={() => fetchReport(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* SU Overview + Storage Quota */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SUOverview report={report} />
        <QuotaSection report={report} />
      </div>

      {/* SU by User */}
      <SUByUserTable report={report} />

      {/* Active Jobs */}
      <ActiveJobs report={report} />

      {/* Private Partitions */}
      <PartitionsSection partitions={privatePartitions} />
    </div>
  );
}
