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
  ChevronDown,
  X,
} from "lucide-react";
import { cn, getUserColor } from "@/lib/utils";

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

// ─── Smooth color gradient (emerald → gold → orange → red) ───
// 0-45% greens/limes, 45-65% yellows/golds, 65-85% oranges, 85-92% dark orange, 92-100% reds

const GRADIENT_STOPS: [number, number, number, number][] = [
  [0,     5, 150, 105],  // #059669 emerald
  [25,   75, 179,  61],  // #4bb33d lime-green
  [45,  163, 190,  30],  // #a3be1e yellow-green
  [55,  219, 178,  18],  // #dbb212 gold
  [65,  232, 152,  12],  // #e8980c amber
  [75,  239, 120,   8],  // #ef7808 orange
  [85,  234,  88,  12],  // #ea580c dark orange
  [92,  220,  50,   5],  // #dc3205 red-orange
  [100, 185,  10,   0],  // #b90a00 deep red
];

function interpolateGradient(pct: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(100, pct));
  // Find the two stops surrounding the clamped value
  let lo = 0;
  for (let i = 1; i < GRADIENT_STOPS.length; i++) {
    if (GRADIENT_STOPS[i][0] >= clamped) { lo = i - 1; break; }
    lo = i;
  }
  const hi = Math.min(lo + 1, GRADIENT_STOPS.length - 1);
  const range = GRADIENT_STOPS[hi][0] - GRADIENT_STOPS[lo][0];
  const t = range > 0 ? (clamped - GRADIENT_STOPS[lo][0]) / range : 0;
  return [
    Math.round(GRADIENT_STOPS[lo][1] + (GRADIENT_STOPS[hi][1] - GRADIENT_STOPS[lo][1]) * t),
    Math.round(GRADIENT_STOPS[lo][2] + (GRADIENT_STOPS[hi][2] - GRADIENT_STOPS[lo][2]) * t),
    Math.round(GRADIENT_STOPS[lo][3] + (GRADIENT_STOPS[hi][3] - GRADIENT_STOPS[lo][3]) * t),
  ];
}

/** Returns hex color string for a percentage value */
function getPctColor(pct: number | null | undefined): string {
  if (pct == null) return "#9ca3af"; // muted gray
  const [r, g, b] = interpolateGradient(pct);
  return `rgb(${r},${g},${b})`;
}

/** Returns a subtle tinted background for a percentage value */
function getPctBg(pct: number | null | undefined): string {
  if (pct == null) return "transparent";
  const [r, g, b] = interpolateGradient(pct);
  return `rgba(${r},${g},${b},0.08)`;
}

/** Returns the bar fill color for ProgressBar */
function getPctBarBg(pct: number | null | undefined): string {
  if (pct == null) return "#e5e7eb"; // muted
  const [r, g, b] = interpolateGradient(pct);
  return `rgb(${r},${g},${b})`;
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

// CIL group members — pulled from the report (via `getent group cil` on RCC).
// Falls back to an empty array if the report doesn't include group_members yet.
function getGroupMembers(report: ComputingReport | null): string[] {
  return report?.group_members ?? [];
}

// User colors imported from shared utility

// ─── Progress Bar ─────────────────────────────────────────────

function ProgressBar({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("h-2 rounded-full bg-secondary overflow-hidden", className)}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${clamped}%`, backgroundColor: getPctBarBg(value) }}
      />
    </div>
  );
}

// ─── Section Card ─────────────────────────────────────────────

function Section({ title, icon: Icon, children, className, headerRight }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
  headerRight?: React.ReactNode;
}) {
  return (
    <div className={cn("border border-border rounded-lg bg-card", className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
        </div>
        {headerRight}
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6">
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
          <div className="text-lg font-semibold" style={su.days_left != null ? { color: getPctColor(Math.max(0, 100 - (su.days_left / 365) * 100)) } : undefined}>
            {su.days_left ?? "--"}
            {su.period_end && <span className="text-[10px] text-muted-foreground ml-1.5 font-normal">({su.period_end})</span>}
          </div>
        </div>
      </div>

      {usedPct != null && (
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
            <span>Usage</span>
            <span style={{ color: getPctColor(usedPct) }}>{formatPct(usedPct)}</span>
          </div>
          <ProgressBar value={usedPct} />
        </div>
      )}
    </Section>
  );
}

// ─── SU by User ───────────────────────────────────────────────

function SUByUserTable({ report, userColorMap, selectedUsers, onToggleUser }: {
  report: ComputingReport;
  userColorMap: Map<string, string>;
  selectedUsers: Set<string>;
  onToggleUser: (user: string) => void;
}) {
  const m3 = report.clusters.midway3;
  const users = m3?.service_units.by_user || [];
  const total = m3?.service_units.consumed || 1;
  const partitions = m3?.service_units.by_partition || [];
  const [showPartitions, setShowPartitions] = useState(false);

  if (users.length === 0) return null;

  const hasSelection = selectedUsers.size > 0;

  return (
    <Section title="SU Usage for the Current Cycle" icon={Users}>
      <div className="space-y-2">
        {users.map((u) => {
          const pct = total > 0 ? (u.consumed / total) * 100 : 0;
          const isSelected = selectedUsers.has(u.user);
          const userColor = userColorMap.get(u.user) || "#888";
          return (
            <div
              key={u.user}
              onClick={() => onToggleUser(u.user)}
              className="flex items-center gap-3 cursor-pointer rounded px-1 -mx-1 transition-opacity"
              style={{
                opacity: hasSelection && !isSelected ? 0.4 : 1,
                borderLeft: isSelected ? `3px solid ${userColor}` : "3px solid transparent",
                background: isSelected ? `${userColor}30` : undefined,
              }}
            >
              <div className="flex items-center gap-1.5 w-20 sm:w-32 min-w-0">
                <div style={{ width: 8, height: 8, borderRadius: 2, background: userColor, flexShrink: 0 }} />
                <span className="text-xs font-mono truncate">{u.user}</span>
              </div>
              <div className="flex-1 min-w-0">
                <ProgressBar value={pct} />
              </div>
              <span className="text-xs text-muted-foreground w-16 sm:w-24 text-right">{formatSU(u.consumed)}</span>
              <span className="text-[10px] text-muted-foreground w-8 sm:w-12 text-right">{formatPct(pct)}</span>
            </div>
          );
        })}
      </div>
      {partitions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <button
            onClick={() => setShowPartitions(!showPartitions)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <ChevronDown size={12} className={cn("transition-transform", showPartitions ? "" : "-rotate-90")} />
            By partition
          </button>
          {showPartitions && (
            <div className="mt-2 space-y-1.5 pl-4">
              {partitions.map((p) => {
                const pct = total > 0 ? (p.consumed / total) * 100 : 0;
                return (
                  <div key={p.partition} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground w-20 sm:w-32 truncate">{p.partition}</span>
                    <div className="flex-1 min-w-0">
                      <ProgressBar value={pct} />
                    </div>
                    <span className="text-xs text-muted-foreground w-16 sm:w-24 text-right">{formatSU(p.consumed)}</span>
                    <span className="text-[10px] text-muted-foreground w-8 sm:w-12 text-right">{formatPct(pct)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ─── Partition Colors ─────────────────────────────────────────

const PARTITION_COLORS: Record<string, string> = {};
const PARTITION_PALETTE = [
  "#06b6d4", // cyan
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#ec4899", // pink
  "#f97316", // orange
  "#6366f1", // indigo
  "#e11d48", // rose
];
let nextPartitionIdx = 0;

function getPartitionColor(partition: string): string {
  if (!PARTITION_COLORS[partition]) {
    PARTITION_COLORS[partition] = PARTITION_PALETTE[nextPartitionIdx % PARTITION_PALETTE.length];
    nextPartitionIdx++;
  }
  return PARTITION_COLORS[partition];
}

// ─── Active Jobs ──────────────────────────────────────────────

interface JobGroup {
  user: string;
  partition: string;
  cluster: string;
  running: number;
  pending: number;
  totalCpus: number;
  totalMem: string;
  jobs: (JobEntry & { cluster: string })[];
}

function ActiveJobs({ report, userColorMap, selectedUsers, onToggleUser }: {
  report: ComputingReport;
  userColorMap: Map<string, string>;
  selectedUsers: Set<string>;
  onToggleUser: (user: string) => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const allJobs: (JobEntry & { cluster: string })[] = [];
  for (const [name, cluster] of Object.entries(report.clusters)) {
    if (!cluster) continue;
    for (const job of cluster.jobs.list) {
      if (!isMonitoringJob(job.name)) {
        allJobs.push({ ...job, cluster: name });
      }
    }
  }

  // Group by user + partition
  const groupMap = new Map<string, JobGroup>();
  for (const j of allJobs) {
    const key = `${j.user}|${j.partition}|${j.cluster}`;
    let g = groupMap.get(key);
    if (!g) {
      g = { user: j.user, partition: j.partition, cluster: j.cluster, running: 0, pending: 0, totalCpus: 0, totalMem: "", jobs: [] };
      groupMap.set(key, g);
    }
    if (j.state === "RUNNING") g.running++;
    else if (j.state === "PENDING") g.pending++;
    g.totalCpus += j.cpus || 0;
    g.jobs.push(j);
  }
  // Sum mem per group (parse "XG" strings)
  for (const g of groupMap.values()) {
    let memMb = 0;
    for (const j of g.jobs) {
      const m = String(j.mem_alloc).match(/^([\d.]+)\s*(G|M|T)?/i);
      if (m) {
        const val = parseFloat(m[1]);
        const unit = (m[2] || "M").toUpperCase();
        if (unit === "G") memMb += val * 1024;
        else if (unit === "T") memMb += val * 1024 * 1024;
        else memMb += val;
      }
    }
    if (memMb >= 1024) g.totalMem = `${(memMb / 1024).toFixed(1)}G`;
    else g.totalMem = `${Math.round(memMb)}M`;
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => b.jobs.length - a.jobs.length);

  const running = allJobs.filter(j => j.state === "RUNNING").length;
  const pending = allJobs.filter(j => j.state === "PENDING").length;
  const hasSelection = selectedUsers.size > 0;

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Section title="Active Jobs" icon={Cpu}>
      <div className="flex gap-4 mb-3 text-sm">
        <span>Running: <span className="font-medium text-emerald-500">{running}</span></span>
        <span>Pending: <span className="font-medium text-amber-500">{pending}</span></span>
        <span>Total: <span className="font-medium">{allJobs.length}</span></span>
      </div>

      {groups.length > 0 && (
        <div className="max-h-[400px] overflow-y-auto space-y-1">
          {groups.map((g) => {
            const key = `${g.user}|${g.partition}|${g.cluster}`;
            const isExpanded = expandedGroups.has(key);
            const isSelected = selectedUsers.has(g.user);
            const userColor = userColorMap.get(g.user) || "#888";
            const partColor = getPartitionColor(g.partition);

            return (
              <div key={key} style={{
                opacity: hasSelection && !isSelected ? 0.4 : 1,
                borderLeft: isSelected ? `3px solid ${userColor}` : "3px solid transparent",
                background: isSelected ? `${userColor}30` : undefined,
                transition: "opacity 0.15s",
              }}>
                {/* Summary row */}
                <div
                  className="flex items-center gap-3 py-1.5 px-1 cursor-pointer hover:bg-muted/30 rounded text-xs"
                  onClick={() => toggleGroup(key)}
                >
                  <ChevronDown size={12} className={cn("text-muted-foreground transition-transform flex-shrink-0", isExpanded ? "" : "-rotate-90")} />
                  <div className="flex items-center gap-1.5 min-w-0 w-28 sm:w-36">
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: userColor, flexShrink: 0 }} />
                    <span className="font-mono truncate" onClick={(e) => { e.stopPropagation(); onToggleUser(g.user); }}>{g.user}</span>
                  </div>
                  <span className="font-mono" style={{ color: partColor }}>{g.partition}</span>
                  <span className="text-muted-foreground">{g.cluster}</span>
                  <div className="flex gap-2 ml-auto">
                    {g.running > 0 && <span className="text-emerald-500 font-medium">{g.running} running</span>}
                    {g.pending > 0 && <span className="text-amber-500 font-medium">{g.pending} pending</span>}
                    <span className="text-muted-foreground">{g.totalCpus} CPUs</span>
                    <span className="text-muted-foreground">{g.totalMem}</span>
                  </div>
                </div>

                {/* Expanded job list */}
                {isExpanded && (
                  <div className="overflow-x-auto ml-5 mb-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground text-left">
                          <th className="pb-1 pr-3 font-medium">State</th>
                          <th className="pb-1 pr-3 font-medium">Job ID</th>
                          <th className="pb-1 pr-3 font-medium">Name</th>
                          <th className="pb-1 pr-3 font-medium">CPUs</th>
                          <th className="pb-1 pr-3 font-medium">Mem</th>
                          <th className="pb-1 pr-3 font-medium">Elapsed</th>
                          <th className="pb-1 pr-3 font-medium">Limit</th>
                          <th className="pb-1 font-medium">Left</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.jobs.map((j) => (
                          <tr key={`${j.cluster}-${j.job_id}`} className="border-t border-border/30">
                            <td className={cn("py-1 pr-3 font-medium", stateColor(j.state))}>{j.state}</td>
                            <td className="py-1 pr-3 font-mono">{j.job_id}</td>
                            <td className="py-1 pr-3 max-w-[150px] truncate">{j.name}</td>
                            <td className="py-1 pr-3">{j.cpus}</td>
                            <td className="py-1 pr-3">{j.mem_alloc}</td>
                            <td className="py-1 pr-3 font-mono">{j.elapsed}</td>
                            <td className="py-1 pr-3 font-mono">{j.time_limit}</td>
                            <td className="py-1 font-mono">{j.time_left}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {allJobs.length === 0 && (
        <div className="text-sm text-muted-foreground">No active jobs.</div>
      )}
    </Section>
  );
}


// ─── PCB Grid Constants ───────────────────────────────────────

const CELL = 10;
const GAP = 1.5;
const CPU_COLS = 8;
const RAM_COLS = 32;

// ─── Cluster / Partition PCB Themes ──────────────────────────

type ClusterTheme = {
  board: string;
  border: string;
  trace: string;
  label: string;
  hole: string;
  led: string;
};

const MIDWAY3_VARIANTS: Record<string, ClusterTheme> = {
  cil: {
    board: "#0a5c2f", border: "#0d7a3e",
    trace: "rgba(74,222,128,0.05)", label: "#4ade80",
    hole: "#065f28", led: "#22c55e",
  },
  _teal: {
    board: "#0a4c3f", border: "#0d6a4e",
    trace: "rgba(74,222,180,0.05)", label: "#4adead",
    hole: "#064f38", led: "#22c5a0",
  },
  _lime: {
    board: "#1a5c1f", border: "#1d7a2e",
    trace: "rgba(120,222,74,0.05)", label: "#80de4a",
    hole: "#165f18", led: "#4cc522",
  },
};

const MIDWAY2_VARIANTS: Record<string, ClusterTheme> = {
  _base: {
    board: "#0f2847", border: "#1a3d6b",
    trace: "rgba(96,165,250,0.05)", label: "#60a5fa",
    hole: "#0c2240", led: "#3b82f6",
  },
  _indigo: {
    board: "#1a1f47", border: "#2a2d6b",
    trace: "rgba(129,140,248,0.05)", label: "#818cf8",
    hole: "#141840", led: "#6366f1",
  },
  _cyan: {
    board: "#0f3847", border: "#1a4d6b",
    trace: "rgba(96,210,250,0.05)", label: "#60d5fa",
    hole: "#0c3040", led: "#22b8cf",
  },
};

function getPartitionTheme(cluster: string, partitionName: string): ClusterTheme {
  if (cluster === "midway3") {
    if (MIDWAY3_VARIANTS[partitionName]) return MIDWAY3_VARIANTS[partitionName];
    // Auto-assign from remaining variants
    const keys = Object.keys(MIDWAY3_VARIANTS).filter(k => k.startsWith("_"));
    const idx = Math.abs(hashCode(partitionName)) % keys.length;
    return MIDWAY3_VARIANTS[keys[idx]];
  }
  if (cluster === "midway2") {
    if (MIDWAY2_VARIANTS[partitionName]) return MIDWAY2_VARIANTS[partitionName];
    const keys = Object.keys(MIDWAY2_VARIANTS);
    const idx = Math.abs(hashCode(partitionName)) % keys.length;
    return MIDWAY2_VARIANTS[keys[idx]];
  }
  // Fallback: midway3 base green
  return MIDWAY3_VARIANTS.cil;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

// ─── State Badge ──────────────────────────────────────────────

function StateBadge({ state }: { state: string }) {
  const styles: Record<string, { bg: string; fg: string }> = {
    mixed: { bg: "#fef3c7", fg: "#78600d" },
    mix: { bg: "#fef3c7", fg: "#78600d" },
    idle: { bg: "#d1fae5", fg: "#065f46" },
    allocated: { bg: "#fee2e2", fg: "#991b1b" },
    alloc: { bg: "#fee2e2", fg: "#991b1b" },
  };
  const s = styles[state.toLowerCase()] || styles.idle;
  return (
    <span style={{
      fontSize: 7, fontWeight: 700, textTransform: "uppercase",
      padding: "0px 4px", borderRadius: 2,
      background: s.bg, color: s.fg, letterSpacing: "0.06em",
      lineHeight: "14px",
    }}>{state}</span>
  );
}

// ─── CPU Grid (8×8 solid squares) ─────────────────────────────

type CellData = { color: string | null; user: string | null };

function CpuGrid({ node, userColorMap, selectedUsers, onToggleUser }: {
  node: PartitionNode;
  userColorMap: Map<string, string>;
  selectedUsers: Set<string>;
  onToggleUser: (user: string) => void;
}) {
  const cells: CellData[] = [];
  for (const u of node.users) {
    const color = userColorMap.get(u.user) || "#888";
    for (let i = 0; i < u.cpus; i++) cells.push({ color, user: u.user });
  }
  while (cells.length < node.cpus_total) cells.push({ color: null, user: null });

  const hasSelection = selectedUsers.size > 0;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${CPU_COLS}, ${CELL}px)`,
      gap: GAP,
      flexShrink: 0,
    }}>
      {cells.map((cell, i) => {
        const isSelected = cell.user != null && selectedUsers.has(cell.user);
        const dimmed = hasSelection && cell.color != null && !isSelected;
        const isFree = cell.color == null;
        return (
          <div key={i} onClick={cell.user ? () => onToggleUser(cell.user!) : undefined} style={{
            width: CELL, height: CELL, borderRadius: 1,
            background: cell.color || "var(--pcb-free-cpu)",
            border: isSelected ? "2px solid #facc15" : cell.color ? `1px solid ${cell.color}` : "1px solid var(--pcb-free-border)",
            boxShadow: isSelected ? "0 0 4px #facc15, 0 0 8px rgba(250,204,21,0.4)" : cell.color ? `0 0 2px ${cell.color}40` : "none",
            opacity: hasSelection ? (isSelected ? 1 : dimmed ? 0.25 : isFree ? 0.15 : 1) : 1,
            transition: "opacity 0.15s, box-shadow 0.15s",
            position: isSelected ? "relative" as const : undefined,
            zIndex: isSelected ? 1 : undefined,
            cursor: cell.user ? "pointer" : undefined,
          }} />
        );
      })}
    </div>
  );
}

// ─── RAM Grid (32×8 with centered dots) ────────────────────────

function RamGrid({ node, userColorMap, selectedUsers, onToggleUser }: {
  node: PartitionNode;
  userColorMap: Map<string, string>;
  selectedUsers: Set<string>;
  onToggleUser: (user: string) => void;
}) {
  const totalCells = Math.round(node.mem_total_gb);
  const cells: CellData[] = [];

  for (const u of node.users) {
    const color = userColorMap.get(u.user) || "#888";
    for (let i = 0; i < Math.round(u.mem_alloc_gb); i++) cells.push({ color, user: u.user });
  }
  while (cells.length < totalCells) cells.push({ color: null, user: null });

  const hasSelection = selectedUsers.size > 0;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${RAM_COLS}, ${CELL}px)`,
      gap: GAP,
      flexShrink: 0,
    }}>
      {cells.map((cell, i) => {
        const isSelected = cell.user != null && selectedUsers.has(cell.user);
        const dimmed = hasSelection && cell.color != null && !isSelected;
        const isFree = cell.color == null;
        return (
          <div key={i} onClick={cell.user ? () => onToggleUser(cell.user!) : undefined} style={{
            width: CELL, height: CELL, borderRadius: 1,
            background: cell.color ? `${cell.color}25` : "var(--pcb-free-ram)",
            border: isSelected ? "2px solid #facc15" : cell.color ? `1px solid ${cell.color}35` : "1px solid var(--pcb-free-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: hasSelection ? (isSelected ? 1 : dimmed ? 0.25 : isFree ? 0.15 : 1) : 1,
            transition: "opacity 0.15s, box-shadow 0.15s",
            position: isSelected ? "relative" as const : undefined,
            zIndex: isSelected ? 1 : undefined,
            cursor: cell.user ? "pointer" : undefined,
          }}>
            <div style={{
              width: 3, height: 3, borderRadius: "50%",
              background: cell.color || "var(--pcb-free-ram-dot)",
              opacity: cell.color ? 1 : 0.3,
              boxShadow: isSelected ? "0 0 3px #facc15, 0 0 6px rgba(250,204,21,0.4)" : cell.color ? `0 0 2px ${cell.color}50` : "none",
            }} />
          </div>
        );
      })}
    </div>
  );
}

// ─── Node Slot (horizontal rack unit) ─────────────────────────

function NodeSlot({ node, userColorMap, selectedUsers, theme, onToggleUser }: {
  node: PartitionNode;
  userColorMap: Map<string, string>;
  selectedUsers: Set<string>;
  theme: ClusterTheme;
  onToggleUser: (user: string) => void;
}) {
  const nodeId = node.name.replace(/^midway\d+-/, "");

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      background: theme.board,
      padding: "6px 8px",
      borderTop: `1px solid ${theme.border}`,
      borderLeft: `2px solid ${theme.border}`,
      borderRight: `2px solid ${theme.border}`,
      position: "relative",
      backgroundImage: `
        linear-gradient(${theme.trace} 1px, transparent 1px),
        linear-gradient(90deg, ${theme.trace} 1px, transparent 1px)
      `,
      backgroundSize: "10px 10px",
    }}>
      {/* Node ID sidebar */}
      <div style={{
        width: 50, flexShrink: 0,
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
        marginRight: 8,
      }}>
        <span style={{
          fontFamily: "monospace", fontWeight: 700, fontSize: 11,
          color: theme.label, letterSpacing: "0.05em",
        }}>{nodeId}</span>
        <StateBadge state={node.state} />
      </div>

      {/* Divider */}
      <div style={{ width: 1, alignSelf: "stretch", background: `${theme.label}20`, marginRight: 8 }} />

      {/* CPU label (vertical) */}
      <div style={{
        fontSize: 6, color: theme.label, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.1em",
        fontFamily: "monospace", opacity: 0.6,
        writingMode: "vertical-rl", transform: "rotate(180deg)",
        marginRight: 3,
      }}>CPU</div>

      {/* CPU 8×8 */}
      <CpuGrid node={node} userColorMap={userColorMap} selectedUsers={selectedUsers} onToggleUser={onToggleUser} />

      {/* Trace divider */}
      <div style={{
        width: 0, alignSelf: "stretch",
        borderLeft: `1px dashed ${theme.label}20`,
        margin: "0 6px",
      }} />

      {/* RAM label (vertical) */}
      <div style={{
        fontSize: 6, color: theme.label, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.1em",
        fontFamily: "monospace", opacity: 0.6,
        writingMode: "vertical-rl", transform: "rotate(180deg)",
        marginRight: 3,
      }}>RAM</div>

      {/* RAM 32×8 */}
      <RamGrid node={node} userColorMap={userColorMap} selectedUsers={selectedUsers} onToggleUser={onToggleUser} />

      {/* Rack screw holes */}
      <div style={{ marginLeft: 6, display: "flex", flexDirection: "column", justifyContent: "space-between", alignSelf: "stretch" }}>
        <div style={{ width: 4, height: 4, borderRadius: "50%", background: theme.hole, border: `1px solid ${theme.label}25` }} />
        <div style={{ width: 4, height: 4, borderRadius: "50%", background: theme.hole, border: `1px solid ${theme.label}25` }} />
      </div>
    </div>
  );
}

// ─── Rack Frame ───────────────────────────────────────────────

function RackFrame({ nodes, userColorMap, selectedUsers, theme, partitionName, onToggleUser }: {
  nodes: PartitionNode[];
  userColorMap: Map<string, string>;
  selectedUsers: Set<string>;
  theme: ClusterTheme;
  partitionName: string;
  onToggleUser: (user: string) => void;
}) {
  return (
    <div style={{
      display: "inline-flex", flexDirection: "column",
      boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
      borderRadius: 6,
      overflow: "hidden",
    }}>
      {/* Top bar */}
      <div style={{
        background: "#1a1a2e", padding: "3px 10px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderBottom: "1px solid #333",
      }}>
        <span style={{ fontSize: 8, color: "#6b7280", fontFamily: "monospace", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {partitionName} · {nodes.length}U
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: theme.led }} />
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: `${theme.led}40` }} />
        </div>
      </div>

      {/* Node slots */}
      {nodes.map((node) => (
        <NodeSlot
          key={node.name}
          node={node}
          userColorMap={userColorMap}
          selectedUsers={selectedUsers}
          theme={theme}
          onToggleUser={onToggleUser}
        />
      ))}

      {/* Bottom bar */}
      <div style={{
        background: "#1a1a2e", padding: "3px 10px",
        borderTop: "1px solid #333",
      }}>
        <span style={{ fontSize: 7, color: "#4b5563", fontFamily: "monospace" }}>
          PWR OK · {nodes.length}×{nodes[0]?.cpus_total || 0}C · {nodes.length}×{Math.round(nodes[0]?.mem_total_gb || 0)}G
        </span>
      </div>
    </div>
  );
}

// ─── Grid Key (PCB styled) ───────────────────────────────────

function GridKey({ theme }: { theme: ClusterTheme }) {
  return (
    <div style={{
      display: "inline-flex", gap: 10, alignItems: "center", fontSize: 8,
      background: theme.board, borderRadius: 3, padding: "2px 8px",
      border: `1px solid ${theme.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <div style={{ width: 8, height: 8, borderRadius: 1, background: "#3b82f6" }} />
        <span style={{ color: theme.label }}>CPU core</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <div style={{
          width: 8, height: 8, borderRadius: 1,
          background: "#3b82f625", border: "1px solid #3b82f640",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#3b82f6" }} />
        </div>
        <span style={{ color: theme.label }}>1 GB RAM</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <div style={{ width: 8, height: 8, borderRadius: 1, background: "var(--pcb-free-cpu)", border: "1px solid var(--pcb-free-border)" }} />
        <span style={{ color: theme.label }}>Free</span>
      </div>
    </div>
  );
}


// ─── Consolidated User Table (per-node + total, active/inactive sections) ───

function ConsolidatedUserTable({ partitions, userColorMap, allAccountUsers, selectedUsers, onToggleUser }: {
  partitions: { name: string; cluster: string; data: PartitionData }[];
  userColorMap: Map<string, string>;
  allAccountUsers: string[];
  selectedUsers: Set<string>;
  onToggleUser: (user: string) => void;
}) {
  const [showInactive, setShowInactive] = useState(false);

  const nodes = useMemo(() => {
    const result: { id: string; node: PartitionNode }[] = [];
    for (const { data } of partitions) {
      for (const node of data.nodes) {
        result.push({ id: node.name.replace(/^midway\d+-/, ""), node });
      }
    }
    return result;
  }, [partitions]);

  const { activeUsers, inactiveUsers } = useMemo(() => {
    const allSet = new Set<string>(allAccountUsers);
    for (const { node } of nodes) {
      for (const u of node.users) allSet.add(u.user);
    }
    const sorted = Array.from(allSet).sort();
    const active: string[] = [];
    const inactive: string[] = [];
    for (const user of sorted) {
      const hasAny = nodes.some(({ node }) => node.users.some(u => u.user === user));
      if (hasAny) active.push(user);
      else inactive.push(user);
    }
    return { activeUsers: active, inactiveUsers: inactive };
  }, [nodes, allAccountUsers]);

  const totalCpus = nodes.reduce((s, { node }) => s + node.cpus_total, 0);
  const totalMem = nodes.reduce((s, { node }) => s + Math.round(node.mem_total_gb), 0);
  const totalColCount = 1 + nodes.length * 4 + 4;

  if (activeUsers.length === 0 && inactiveUsers.length === 0) return null;

  const thStyle: React.CSSProperties = {
    padding: "5px 8px", fontSize: 9, fontWeight: 600,
    textTransform: "uppercase", color: "hsl(var(--muted-foreground))",
    borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted))",
    textAlign: "center", letterSpacing: "0.04em",
  };
  const tdStyle: React.CSSProperties = {
    padding: "6px 8px", fontSize: 11,
    fontFamily: "'Courier New', monospace",
    textAlign: "right", borderBottom: "1px solid hsl(var(--border) / 0.5)",
  };
  const dash = <span style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>&mdash;</span>;

  function renderUserRow(user: string, isActive: boolean) {
    const isSelected = selectedUsers.has(user);
    const userColor = userColorMap.get(user);

    let sumCpu = 0, sumMem = 0;
    nodes.forEach(({ node }) => {
      const ui = node.users.find(u => u.user === user);
      if (ui) { sumCpu += ui.cpus; sumMem += ui.mem_alloc_gb; }
    });
    const totalCpuPct = sumCpu > 0 ? (sumCpu / totalCpus * 100) : 0;
    const totalMemPct = sumMem > 0 ? (sumMem / totalMem * 100) : 0;

    return (
      <tr
        key={user}
        onClick={() => onToggleUser(user)}
        style={{
          opacity: isActive ? 1 : 0.35,
          cursor: "pointer",
          borderLeft: isSelected ? `3px solid ${userColor}` : "3px solid transparent",
          background: isSelected ? `${userColor}30` : undefined,
        }}
      >
        <td style={{ ...tdStyle, textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: userColor, flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: 11 }}>{user}</span>
          </div>
        </td>
        {nodes.map(({ id, node }) => {
          const ui = node.users.find(u => u.user === user);
          const cpuPct = ui ? (ui.cpus / node.cpus_total * 100) : 0;
          const memPct = ui ? (ui.mem_alloc_gb / node.mem_total_gb * 100) : 0;
          return (
            <React.Fragment key={id}>
              <td style={{ ...tdStyle, borderLeft: "2px solid hsl(var(--border) / 0.5)" }}>{ui ? ui.cpus : dash}</td>
              <td style={{ ...tdStyle, color: ui ? getPctColor(cpuPct) : "hsl(var(--muted-foreground) / 0.4)", background: ui ? getPctBg(cpuPct) : "transparent", fontWeight: ui ? 600 : 400 }}>
                {ui ? `${cpuPct.toFixed(1)}%` : "\u2014"}
              </td>
              <td style={tdStyle}>{ui ? `${Math.round(ui.mem_alloc_gb)}G` : dash}</td>
              <td style={{ ...tdStyle, color: ui ? getPctColor(memPct) : "hsl(var(--muted-foreground) / 0.4)", background: ui ? getPctBg(memPct) : "transparent", fontWeight: ui ? 600 : 400 }}>
                {ui ? `${memPct.toFixed(1)}%` : "\u2014"}
              </td>
            </React.Fragment>
          );
        })}
        <td style={{ ...tdStyle, borderLeft: "2px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.5)", fontWeight: 600 }}>
          {sumCpu > 0 ? sumCpu : dash}
        </td>
        <td style={{ ...tdStyle, background: "hsl(var(--muted) / 0.5)", color: sumCpu > 0 ? getPctColor(totalCpuPct) : "hsl(var(--muted-foreground) / 0.4)", fontWeight: sumCpu > 0 ? 700 : 400 }}>
          {sumCpu > 0 ? `${totalCpuPct.toFixed(1)}%` : "\u2014"}
        </td>
        <td style={{ ...tdStyle, background: "hsl(var(--muted) / 0.5)", fontWeight: 600 }}>
          {sumMem > 0 ? `${Math.round(sumMem)}G` : dash}
        </td>
        <td style={{ ...tdStyle, background: "hsl(var(--muted) / 0.5)", color: sumMem > 0 ? getPctColor(totalMemPct) : "hsl(var(--muted-foreground) / 0.4)", fontWeight: sumMem > 0 ? 700 : 400 }}>
          {sumMem > 0 ? `${totalMemPct.toFixed(1)}%` : "\u2014"}
        </td>
      </tr>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ ...thStyle, textAlign: "left", minWidth: 130 }}>User</th>
            {nodes.map(({ id, node }) => (
              <th key={id} colSpan={4} style={{ ...thStyle, borderLeft: "2px solid hsl(var(--border))" }}>
                <span style={{ fontFamily: "monospace" }}>{id}</span>
                <span style={{ fontWeight: 400, marginLeft: 4, fontSize: 8 }}>({node.cpus_total}C/{Math.round(node.mem_total_gb)}G)</span>
              </th>
            ))}
            <th colSpan={4} style={{ ...thStyle, borderLeft: "2px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.7)" }}>
              Total
              <span style={{ fontWeight: 400, marginLeft: 4, fontSize: 8 }}>({totalCpus}C/{totalMem}G)</span>
            </th>
          </tr>
          <tr>
            {[...nodes.map(n => n.id), "__total__"].map((id, gi) => {
              const isTotal = gi === nodes.length;
              return (
                <React.Fragment key={id}>
                  <th style={{ ...thStyle, fontSize: 8, borderLeft: `2px solid hsl(var(--border))`, background: isTotal ? "hsl(var(--muted) / 0.7)" : "hsl(var(--muted))" }}>CPU</th>
                  <th style={{ ...thStyle, fontSize: 8, background: isTotal ? "hsl(var(--muted) / 0.7)" : "hsl(var(--muted))" }}>%</th>
                  <th style={{ ...thStyle, fontSize: 8, background: isTotal ? "hsl(var(--muted) / 0.7)" : "hsl(var(--muted))" }}>RAM</th>
                  <th style={{ ...thStyle, fontSize: 8, background: isTotal ? "hsl(var(--muted) / 0.7)" : "hsl(var(--muted))" }}>%</th>
                </React.Fragment>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* Totals row */}
          {(() => {
            const totRowStyle: React.CSSProperties = { ...tdStyle, background: "hsl(var(--muted))", fontWeight: 700, color: "hsl(var(--foreground))", borderBottom: "2px solid hsl(var(--border))" };
            const nodeTotals = nodes.map(({ node }) => {
              let cpu = 0, mem = 0;
              for (const u of node.users) { cpu += u.cpus; mem += u.mem_alloc_gb; }
              return { cpu, mem, cpuPct: (cpu / node.cpus_total) * 100, memPct: (mem / node.mem_total_gb) * 100 };
            });
            const grandCpu = nodeTotals.reduce((s, n) => s + n.cpu, 0);
            const grandMem = nodeTotals.reduce((s, n) => s + n.mem, 0);
            const grandCpuPct = totalCpus > 0 ? (grandCpu / totalCpus * 100) : 0;
            const grandMemPct = totalMem > 0 ? (grandMem / totalMem * 100) : 0;
            return (
              <tr>
                <td style={{ ...totRowStyle, textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: "#9ca3af", flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 11 }}>Total</span>
                  </div>
                </td>
                {nodeTotals.map((nt, i) => (
                  <React.Fragment key={nodes[i].id}>
                    <td style={{ ...totRowStyle, borderLeft: "2px solid hsl(var(--border))" }}>{nt.cpu}</td>
                    <td style={{ ...totRowStyle, color: getPctColor(nt.cpuPct) }}>{nt.cpuPct.toFixed(1)}%</td>
                    <td style={totRowStyle}>{Math.round(nt.mem)}G</td>
                    <td style={{ ...totRowStyle, color: getPctColor(nt.memPct) }}>{nt.memPct.toFixed(1)}%</td>
                  </React.Fragment>
                ))}
                <td style={{ ...totRowStyle, borderLeft: "2px solid hsl(var(--border))", background: "hsl(var(--muted) / 0.7)" }}>{grandCpu}</td>
                <td style={{ ...totRowStyle, background: "hsl(var(--muted) / 0.7)", color: getPctColor(grandCpuPct) }}>{grandCpuPct.toFixed(1)}%</td>
                <td style={{ ...totRowStyle, background: "hsl(var(--muted) / 0.7)" }}>{Math.round(grandMem)}G</td>
                <td style={{ ...totRowStyle, background: "hsl(var(--muted) / 0.7)", color: getPctColor(grandMemPct) }}>{grandMemPct.toFixed(1)}%</td>
              </tr>
            );
          })()}

          {/* Active users section */}
          {activeUsers.map(user => renderUserRow(user, true))}

          {/* Inactive users section header */}
          {inactiveUsers.length > 0 && (
            <tr
              onClick={() => setShowInactive(v => !v)}
              style={{ cursor: "pointer" }}
            >
              <td
                colSpan={totalColCount}
                style={{
                  padding: "6px 8px", fontSize: 10, fontWeight: 600,
                  textTransform: "uppercase", color: "hsl(var(--muted-foreground))",
                  borderBottom: "1px solid hsl(var(--border))", borderTop: "1px solid hsl(var(--border))",
                  letterSpacing: "0.04em", background: "hsl(var(--muted) / 0.5)",
                }}
              >
                <span style={{ marginRight: 4, display: "inline-block", width: 10 }}>{showInactive ? "\u25be" : "\u25b8"}</span>
                Inactive ({inactiveUsers.length})
              </td>
            </tr>
          )}

          {/* Inactive user rows */}
          {showInactive && inactiveUsers.map(user => renderUserRow(user, false))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Partitions Section ───────────────────────────────────────

function PartitionsSection({ partitions, report, userColorMap, selectedUsers, onToggleUser }: {
  partitions: { name: string; cluster: string; data: PartitionData }[];
  report: ComputingReport;
  userColorMap: Map<string, string>;
  selectedUsers: Set<string>;
  onToggleUser: (user: string) => void;
}) {

  // All CIL group members + any SU users not in the group list
  const allAccountUsers = useMemo(() => {
    const set = new Set<string>(getGroupMembers(report));
    for (const cluster of Object.values(report.clusters)) {
      if (!cluster) continue;
      for (const u of cluster.service_units.by_user) {
        if (u.user) set.add(u.user);
      }
    }
    return Array.from(set).sort();
  }, [report]);

  if (partitions.length === 0) return null;

  return (
    <Section title="Partition CIL · Nodes" icon={Server}>
      {partitions.map(({ name, cluster, data }) => {
        const t = data.totals;
        const theme = getPartitionTheme(cluster, name);
        return (
          <div key={`${cluster}-${name}`}>
            <div className="text-[10px] text-muted-foreground mb-3">
              <span className="font-medium text-foreground text-xs">{name}</span>
              <span className="ml-2">
                {t.nodes_total} nodes &mdash; {t.nodes_idle} idle, {t.nodes_mixed} mixed, {t.nodes_allocated} allocated
                {t.nodes_down > 0 && `, ${t.nodes_down} down`}
              </span>
            </div>

            {/* Rack + Table: stacked on mobile, side-by-side on lg+ */}
            <div className="flex flex-col lg:flex-row gap-4 items-center lg:items-start">
              {/* Rack + legend — centered on mobile, left-aligned on desktop */}
              <div className="flex flex-col items-center lg:items-start shrink-0 max-w-full overflow-hidden">
                <div className="pcb-rack-scale">
                  <RackFrame nodes={data.nodes} userColorMap={userColorMap} selectedUsers={selectedUsers} theme={theme} partitionName={name} onToggleUser={onToggleUser} />
                  <div style={{ marginTop: 6 }}>
                    <GridKey theme={theme} />
                  </div>
                </div>
              </div>
              {/* Table */}
              <div className="w-full lg:flex-1 overflow-x-auto min-w-0">
                <ConsolidatedUserTable
                  partitions={[{ name, cluster, data }]}
                  userColorMap={userColorMap}
                  allAccountUsers={allAccountUsers}
                  selectedUsers={selectedUsers}
                  onToggleUser={onToggleUser}
                />
              </div>
            </div>
          </div>
        );
      })}
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
          {q.space_pct != null && <span className="ml-2" style={{ color: getPctColor(q.space_pct) }}>{formatPct(q.space_pct)}</span>}
        </span>
      </div>
      <ProgressBar value={q.space_pct ?? 0} />
      {q.files_used != null && q.files_limit != null && (
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>Files</span>
          <span>
            {q.files_used.toLocaleString()} / {q.files_limit.toLocaleString()}
            {q.files_pct != null && <span className="ml-2" style={{ color: getPctColor(q.files_pct) }}>{formatPct(q.files_pct)}</span>}
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
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());

  const toggleUser = useCallback((user: string) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(user)) next.delete(user);
      else next.add(user);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedUsers(new Set()), []);

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

  if (error && !report) {
    return (
      <div className="border border-border rounded-lg bg-card p-6 text-center">
        <AlertTriangle className="mx-auto mb-2 text-amber-500" size={24} />
        <div className="text-sm text-foreground mb-1">Could not load computing data</div>
        <div className="text-xs text-muted-foreground mb-3">{error}</div>
        <button onClick={() => fetchReport()} className="text-xs text-primary hover:underline">Try again</button>
      </div>
    );
  }

  // Show skeleton layout while loading
  if (!report) {
    return (
      <div className="space-y-4 animate-pulse">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Clock size={12} />
            Loading report...
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw size={12} className="animate-spin" />
            Refresh
          </div>
        </div>

        {/* SU Overview + Storage Quota skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title="Service Units" icon={Flame}>
            <div className="space-y-3">
              <div className="h-3 bg-secondary rounded w-3/4" />
              <div className="h-8 bg-secondary rounded" />
              <div className="h-3 bg-secondary rounded w-1/2" />
              <div className="h-3 bg-secondary rounded w-2/3" />
            </div>
          </Section>
          <Section title="Storage Quotas" icon={HardDrive}>
            <div className="space-y-3">
              <div className="h-3 bg-secondary rounded w-3/4" />
              <div className="h-8 bg-secondary rounded" />
              <div className="h-3 bg-secondary rounded w-1/2" />
              <div className="h-3 bg-secondary rounded w-2/3" />
            </div>
          </Section>
        </div>

        {/* SU by User skeleton */}
        <Section title="SU Usage for the Current Cycle" icon={Users}>
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-3 bg-secondary rounded w-20" />
                <div className="h-3 bg-secondary rounded flex-1" />
                <div className="h-3 bg-secondary rounded w-16" />
              </div>
            ))}
          </div>
        </Section>

        {/* Active Jobs skeleton */}
        <Section title="Active Jobs" icon={Cpu}>
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-3 bg-secondary rounded w-16" />
                <div className="h-3 bg-secondary rounded w-24" />
                <div className="h-3 bg-secondary rounded flex-1" />
                <div className="h-3 bg-secondary rounded w-20" />
              </div>
            ))}
          </div>
        </Section>

        {/* Partitions skeleton */}
        <Section title="Partitions" icon={Server}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border border-border rounded-lg p-4 space-y-2">
                <div className="h-3 bg-secondary rounded w-1/3" />
                <div className="h-6 bg-secondary rounded" />
                <div className="h-3 bg-secondary rounded w-1/2" />
              </div>
            ))}
          </div>
        </Section>
      </div>
    );
  }

  // Global user color map — built once, shared by all components
  const globalUserColorMap = (() => {
    const allUsers = new Set<string>(getGroupMembers(report));
    for (const cluster of Object.values(report.clusters)) {
      if (!cluster) continue;
      for (const u of cluster.service_units.by_user) {
        if (u.user) allUsers.add(u.user);
      }
      for (const job of cluster.jobs.list) {
        if (job.user) allUsers.add(job.user);
      }
      for (const pdata of Object.values(cluster.partitions)) {
        for (const node of pdata.nodes) {
          for (const u of node.users) allUsers.add(u.user);
        }
      }
    }
    const map = new Map<string, string>();
    for (const user of allUsers) {
      map.set(user, getUserColor(user));
    }
    return map;
  })();

  // Collect private partitions from all clusters
  const privatePartitions: { name: string; cluster: string; data: PartitionData }[] = [];
  for (const [clusterName, cluster] of Object.entries(report.clusters)) {
    if (!cluster) continue;
    for (const [pname, pdata] of Object.entries(cluster.partitions)) {
      if (pdata.is_private) {
        privatePartitions.push({ name: pname, cluster: clusterName, data: pdata });
      }
    }
  }

  const publishedAt = report.report_meta.published_at;

  return (
    <div className="space-y-4">
      {/* Header with refresh + clear selection */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Clock size={12} />
          Report: {timeAgo(publishedAt)}
          <span className="text-[10px]">({new Date(publishedAt).toLocaleString()})</span>
          {selectedUsers.size > 0 && (
            <button
              onClick={clearSelection}
              className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={10} />
              {selectedUsers.size} selected
            </button>
          )}
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
      <SUByUserTable report={report} userColorMap={globalUserColorMap} selectedUsers={selectedUsers} onToggleUser={toggleUser} />

      {/* Active Jobs */}
      <ActiveJobs report={report} userColorMap={globalUserColorMap} selectedUsers={selectedUsers} onToggleUser={toggleUser} />

      {/* Private Partitions */}
      <PartitionsSection partitions={privatePartitions} report={report} userColorMap={globalUserColorMap} selectedUsers={selectedUsers} onToggleUser={toggleUser} />
    </div>
  );
}
