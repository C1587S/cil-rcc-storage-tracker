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

// CIL group members (from `getent group cil` on midway3)
// This is the canonical list — SU data only includes users who consumed SUs
const CIL_GROUP_MEMBERS = [
  "aarode", "amirjina", "atiwari2", "blanco", "bmalevich", "bolliger",
  "cadavidsanchez", "champion", "davidrzhdu", "do1", "egrenier",
  "emanakayama", "hultgren", "jenniferagbo", "johannarayl", "jonahmgilbert",
  "jrising", "kmccusker", "maiqi", "mdefranciosi", "mgreenst",
  "nishkasharma", "nvsl", "pnsinha", "rachely", "rfrost", "wanru",
];

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


// ─── PCB Grid Constants ───────────────────────────────────────

const CELL = 8;
const GAP = 1;
const CPU_COLS = 8;
const RAM_COLS = 32;

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

function CpuGrid({ node, userColorMap }: {
  node: PartitionNode;
  userColorMap: Map<string, string>;
}) {
  const cells: (string | null)[] = [];
  for (const u of node.users) {
    const color = userColorMap.get(u.user) || "#888";
    for (let i = 0; i < u.cpus; i++) cells.push(color);
  }
  while (cells.length < node.cpus_total) cells.push(null);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${CPU_COLS}, ${CELL}px)`,
      gap: GAP,
      flexShrink: 0,
    }}>
      {cells.map((color, i) => (
        <div key={i} style={{
          width: CELL, height: CELL, borderRadius: 1,
          background: color || "#d4d4d8",
          border: color ? `1px solid ${color}` : "1px solid rgba(161,161,170,0.25)",
          boxShadow: color ? `0 0 2px ${color}40` : "none",
        }} />
      ))}
    </div>
  );
}

// ─── RAM Grid (32×8 with centered dots) ────────────────────────

function RamGrid({ node, userColorMap }: {
  node: PartitionNode;
  userColorMap: Map<string, string>;
}) {
  const totalCells = Math.round(node.mem_total_gb);
  const cells: (string | null)[] = [];

  for (const u of node.users) {
    const color = userColorMap.get(u.user) || "#888";
    for (let i = 0; i < Math.round(u.mem_alloc_gb); i++) cells.push(color);
  }
  while (cells.length < totalCells) cells.push(null);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${RAM_COLS}, ${CELL}px)`,
      gap: GAP,
      flexShrink: 0,
    }}>
      {cells.map((color, i) => (
        <div key={i} style={{
          width: CELL, height: CELL, borderRadius: 1,
          background: color ? `${color}25` : "#e4e4e7",
          border: color ? `1px solid ${color}35` : "1px solid rgba(161,161,170,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: 3, height: 3, borderRadius: "50%",
            background: color || "#a1a1aa",
            opacity: color ? 1 : 0.3,
            boxShadow: color ? `0 0 2px ${color}50` : "none",
          }} />
        </div>
      ))}
    </div>
  );
}

// ─── Node Slot (horizontal rack unit) ─────────────────────────

function NodeSlot({ node, userColorMap, isFirst, isLast }: {
  node: PartitionNode;
  userColorMap: Map<string, string>;
  isFirst: boolean;
  isLast: boolean;
}) {
  const nodeId = node.name.replace(/^midway\d+-/, "");

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      background: "#0a5c2f",
      padding: "6px 8px",
      borderTop: isFirst ? "2px solid #0d7a3e" : "1px solid #0d7a3e",
      borderBottom: isLast ? "2px solid #0d7a3e" : "none",
      borderLeft: "2px solid #0d7a3e",
      borderRight: "2px solid #0d7a3e",
      position: "relative",
      backgroundImage: `
        linear-gradient(rgba(74,222,128,0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(74,222,128,0.05) 1px, transparent 1px)
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
          color: "#4ade80", letterSpacing: "0.05em",
        }}>{nodeId}</span>
        <StateBadge state={node.state} />
      </div>

      {/* Divider */}
      <div style={{ width: 1, alignSelf: "stretch", background: "#4ade8020", marginRight: 8 }} />

      {/* CPU label (vertical) */}
      <div style={{
        fontSize: 6, color: "#4ade80", fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.1em",
        fontFamily: "monospace", opacity: 0.6,
        writingMode: "vertical-rl", transform: "rotate(180deg)",
        marginRight: 3,
      }}>CPU</div>

      {/* CPU 8×8 */}
      <CpuGrid node={node} userColorMap={userColorMap} />

      {/* Trace divider */}
      <div style={{
        width: 0, alignSelf: "stretch",
        borderLeft: "1px dashed #4ade8020",
        margin: "0 6px",
      }} />

      {/* RAM label (vertical) */}
      <div style={{
        fontSize: 6, color: "#4ade80", fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.1em",
        fontFamily: "monospace", opacity: 0.6,
        writingMode: "vertical-rl", transform: "rotate(180deg)",
        marginRight: 3,
      }}>RAM</div>

      {/* RAM 32×8 */}
      <RamGrid node={node} userColorMap={userColorMap} />

      {/* Rack screw holes */}
      <div style={{ marginLeft: 6, display: "flex", flexDirection: "column", justifyContent: "space-between", alignSelf: "stretch" }}>
        <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#065f28", border: "1px solid #4ade8025" }} />
        <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#065f28", border: "1px solid #4ade8025" }} />
      </div>
    </div>
  );
}

// ─── Rack Frame ───────────────────────────────────────────────

function RackFrame({ nodes, userColorMap }: {
  nodes: PartitionNode[];
  userColorMap: Map<string, string>;
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
          CIL Rack · {nodes.length}U
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e" }} />
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e40" }} />
        </div>
      </div>

      {/* Node slots */}
      {nodes.map((node) => (
        <NodeSlot
          key={node.name}
          node={node}
          userColorMap={userColorMap}
          isFirst={false}
          isLast={false}
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

// ─── Grid Key (PCB styled, for section header) ────────────────

function GridKey() {
  return (
    <div style={{
      display: "inline-flex", gap: 10, alignItems: "center", fontSize: 8,
      background: "#0a5c2f", borderRadius: 3, padding: "2px 8px",
      border: "1px solid #0d7a3e",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <div style={{ width: 8, height: 8, borderRadius: 1, background: "#3b82f6" }} />
        <span style={{ color: "#6ee7a0" }}>CPU core</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <div style={{
          width: 8, height: 8, borderRadius: 1,
          background: "#3b82f625", border: "1px solid #3b82f640",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ width: 3, height: 3, borderRadius: "50%", background: "#3b82f6" }} />
        </div>
        <span style={{ color: "#6ee7a0" }}>1 GB RAM</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <div style={{ width: 8, height: 8, borderRadius: 1, background: "#d4d4d8", border: "1px solid #a1a1aa40" }} />
        <span style={{ color: "#6ee7a0" }}>Free</span>
      </div>
    </div>
  );
}

// ─── Consolidated User Table (per-node + total columns) ───────

function ConsolidatedUserTable({ partitions, userColorMap, allAccountUsers }: {
  partitions: { name: string; data: PartitionData }[];
  userColorMap: Map<string, string>;
  allAccountUsers: string[];
}) {
  const nodes = useMemo(() => {
    const result: { id: string; node: PartitionNode }[] = [];
    for (const { data } of partitions) {
      for (const node of data.nodes) {
        result.push({ id: node.name.replace(/^midway\d+-/, ""), node });
      }
    }
    return result;
  }, [partitions]);

  const allUsers = useMemo(() => {
    // Merge account-wide users with any active partition users
    const set = new Set<string>(allAccountUsers);
    for (const { node } of nodes) {
      for (const u of node.users) set.add(u.user);
    }
    return Array.from(set).sort();
  }, [nodes, allAccountUsers]);

  const totalCpus = nodes.reduce((s, { node }) => s + node.cpus_total, 0);
  const totalMem = nodes.reduce((s, { node }) => s + Math.round(node.mem_total_gb), 0);

  if (allUsers.length === 0) return null;

  const thStyle: React.CSSProperties = {
    padding: "5px 8px", fontSize: 9, fontWeight: 600,
    textTransform: "uppercase", color: "#6b7280",
    borderBottom: "1px solid #e5e7eb", background: "#f9fafb",
    textAlign: "center", letterSpacing: "0.04em",
  };
  const tdStyle: React.CSSProperties = {
    padding: "6px 8px", fontSize: 11,
    fontFamily: "'Courier New', monospace",
    textAlign: "right", borderBottom: "1px solid #f3f4f6",
  };
  const dash = <span style={{ color: "#d1d5db" }}>&mdash;</span>;

  function trafficColor(pct: number): string {
    if (pct >= 70) return "#dc2626";
    if (pct >= 40) return "#d97706";
    return "#059669";
  }
  function trafficBg(pct: number): string {
    if (pct >= 70) return "#fef2f2";
    if (pct >= 40) return "#fefce8";
    return "transparent";
  }

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ ...thStyle, textAlign: "left", minWidth: 130 }}>User</th>
            {nodes.map(({ id, node }) => (
              <th key={id} colSpan={4} style={{ ...thStyle, borderLeft: "2px solid #e5e7eb" }}>
                <span style={{ fontFamily: "monospace" }}>{id}</span>
                <span style={{ fontWeight: 400, marginLeft: 4, fontSize: 8 }}>({node.cpus_total}C/{Math.round(node.mem_total_gb)}G)</span>
              </th>
            ))}
            <th colSpan={4} style={{ ...thStyle, borderLeft: "2px solid #d1d5db", background: "#f3f4f6" }}>
              Total
              <span style={{ fontWeight: 400, marginLeft: 4, fontSize: 8 }}>({totalCpus}C/{totalMem}G)</span>
            </th>
          </tr>
          <tr>
            {[...nodes.map(n => n.id), "__total__"].map((id, gi) => {
              const isTotal = gi === nodes.length;
              return (
                <React.Fragment key={id}>
                  <th style={{ ...thStyle, fontSize: 8, borderLeft: isTotal ? "2px solid #d1d5db" : "2px solid #e5e7eb", background: isTotal ? "#f3f4f6" : "#f9fafb" }}>CPU</th>
                  <th style={{ ...thStyle, fontSize: 8, background: isTotal ? "#f3f4f6" : "#f9fafb" }}>%</th>
                  <th style={{ ...thStyle, fontSize: 8, background: isTotal ? "#f3f4f6" : "#f9fafb" }}>RAM</th>
                  <th style={{ ...thStyle, fontSize: 8, background: isTotal ? "#f3f4f6" : "#f9fafb" }}>%</th>
                </React.Fragment>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* Totals row */}
          {(() => {
            const totRowStyle: React.CSSProperties = { ...tdStyle, background: "#f0f0f0", fontWeight: 700, color: "#111", borderBottom: "2px solid #e5e7eb" };
            // Per-node totals
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
                    <td style={{ ...totRowStyle, borderLeft: "2px solid #e5e7eb" }}>{nt.cpu}</td>
                    <td style={{ ...totRowStyle, color: trafficColor(nt.cpuPct) }}>{nt.cpuPct.toFixed(1)}%</td>
                    <td style={totRowStyle}>{Math.round(nt.mem)}G</td>
                    <td style={{ ...totRowStyle, color: trafficColor(nt.memPct) }}>{nt.memPct.toFixed(1)}%</td>
                  </React.Fragment>
                ))}
                <td style={{ ...totRowStyle, borderLeft: "2px solid #d1d5db", background: "#eaeaea" }}>{grandCpu}</td>
                <td style={{ ...totRowStyle, background: "#eaeaea", color: trafficColor(grandCpuPct) }}>{grandCpuPct.toFixed(1)}%</td>
                <td style={{ ...totRowStyle, background: "#eaeaea" }}>{Math.round(grandMem)}G</td>
                <td style={{ ...totRowStyle, background: "#eaeaea", color: trafficColor(grandMemPct) }}>{grandMemPct.toFixed(1)}%</td>
              </tr>
            );
          })()}
          {allUsers.map((user) => {
            const hasAny = nodes.some(({ node }) => node.users.some(u => u.user === user));

            let sumCpu = 0, sumMem = 0;
            nodes.forEach(({ node }) => {
              const ui = node.users.find(u => u.user === user);
              if (ui) { sumCpu += ui.cpus; sumMem += ui.mem_alloc_gb; }
            });
            const totalCpuPct = sumCpu > 0 ? (sumCpu / totalCpus * 100) : 0;
            const totalMemPct = sumMem > 0 ? (sumMem / totalMem * 100) : 0;

            return (
              <tr key={user} style={{ opacity: hasAny ? 1 : 0.35 }}>
                <td style={{ ...tdStyle, textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: userColorMap.get(user), flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: 11 }}>{user}</span>
                  </div>
                </td>
                {nodes.map(({ id, node }) => {
                  const ui = node.users.find(u => u.user === user);
                  const cpuPct = ui ? (ui.cpus / node.cpus_total * 100) : 0;
                  const memPct = ui ? (ui.mem_alloc_gb / node.mem_total_gb * 100) : 0;
                  return (
                    <React.Fragment key={id}>
                      <td style={{ ...tdStyle, borderLeft: "2px solid #f3f4f6" }}>{ui ? ui.cpus : dash}</td>
                      <td style={{ ...tdStyle, color: ui ? trafficColor(cpuPct) : "#d1d5db", background: ui ? trafficBg(cpuPct) : "transparent", fontWeight: ui ? 600 : 400 }}>
                        {ui ? `${cpuPct.toFixed(1)}%` : "\u2014"}
                      </td>
                      <td style={tdStyle}>{ui ? `${Math.round(ui.mem_alloc_gb)}G` : dash}</td>
                      <td style={{ ...tdStyle, color: ui ? trafficColor(memPct) : "#d1d5db", background: ui ? trafficBg(memPct) : "transparent", fontWeight: ui ? 600 : 400 }}>
                        {ui ? `${memPct.toFixed(1)}%` : "\u2014"}
                      </td>
                    </React.Fragment>
                  );
                })}
                {/* Total column */}
                <td style={{ ...tdStyle, borderLeft: "2px solid #d1d5db", background: "#fafafa", fontWeight: 600 }}>
                  {sumCpu > 0 ? sumCpu : dash}
                </td>
                <td style={{ ...tdStyle, background: "#fafafa", color: sumCpu > 0 ? trafficColor(totalCpuPct) : "#d1d5db", fontWeight: sumCpu > 0 ? 700 : 400 }}>
                  {sumCpu > 0 ? `${totalCpuPct.toFixed(1)}%` : "\u2014"}
                </td>
                <td style={{ ...tdStyle, background: "#fafafa", fontWeight: 600 }}>
                  {sumMem > 0 ? `${Math.round(sumMem)}G` : dash}
                </td>
                <td style={{ ...tdStyle, background: "#fafafa", color: sumMem > 0 ? trafficColor(totalMemPct) : "#d1d5db", fontWeight: sumMem > 0 ? 700 : 400 }}>
                  {sumMem > 0 ? `${totalMemPct.toFixed(1)}%` : "\u2014"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Partitions Section ───────────────────────────────────────

function PartitionsSection({ partitions, report }: {
  partitions: { name: string; data: PartitionData }[];
  report: ComputingReport;
}) {
  // All CIL group members + any SU users not in the hardcoded list
  const allAccountUsers = useMemo(() => {
    const set = new Set<string>(CIL_GROUP_MEMBERS);
    for (const cluster of Object.values(report.clusters)) {
      if (!cluster) continue;
      for (const u of cluster.service_units.by_user) {
        if (u.user) set.add(u.user);
      }
    }
    return Array.from(set).sort();
  }, [report]);

  const userColorMap = useMemo(() => {
    // Build color map from all account users so inactive users also get colors
    const map = new Map<string, string>();
    for (const user of allAccountUsers) {
      map.set(user, USER_COLORS[map.size % USER_COLORS.length]);
    }
    // Also pick up any partition-only users not in SU data
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
  }, [partitions, allAccountUsers]);

  if (partitions.length === 0) return null;

  return (
    <Section title="Partition CIL · Nodes" icon={Server}>
      {partitions.map(({ name, data }) => {
        const t = data.totals;
        return (
          <div key={name}>
            <div className="text-[10px] text-muted-foreground mb-3">
              <span className="font-medium text-foreground text-xs">{name}</span>
              <span className="ml-2">
                {t.nodes_total} nodes &mdash; {t.nodes_idle} idle, {t.nodes_mixed} mixed, {t.nodes_allocated} allocated
                {t.nodes_down > 0 && `, ${t.nodes_down} down`}
              </span>
            </div>

            {/* Rack + Table side by side */}
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <RackFrame nodes={data.nodes} userColorMap={userColorMap} />
              <div style={{ flex: 1, overflowX: "auto", minWidth: 0 }}>
                <ConsolidatedUserTable partitions={[{ name, data }]} userColorMap={userColorMap} allAccountUsers={allAccountUsers} />
              </div>
            </div>
          </div>
        );
      })}

      {/* Legend below everything */}
      <div style={{ marginTop: 12 }}>
        <GridKey />
      </div>
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
      <PartitionsSection partitions={privatePartitions} report={report} />
    </div>
  );
}
