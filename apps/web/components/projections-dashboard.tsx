"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { getProjectionReport } from "@/lib/api";
import type {
  ProjectionReport,
  ProjectionScenario,
  ProjectionGCM,
  ProjectionJobHistoryEntry,
} from "@/lib/types";
import {
  RefreshCw,
  Cpu,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Timer,
  HardDrive,
  Activity,
  ChevronDown,
} from "lucide-react";
import { cn, getUserColor } from "@/lib/utils";

// ─── Status Colors ──────────────────────────────────────────

const STATUS_COLORS = {
  completed: "#059669",
  in_progress: "#d97706",
  failed: "#dc2626",
  not_started: "var(--color-muted)",
} as const;

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  in_progress: "In Progress",
  failed: "Failed",
  not_started: "Not Started",
};

// ─── Helpers ────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return "--";
  return `${n.toFixed(1)}%`;
}

// ─── Progress Bar ───────────────────────────────────────────

function ProgressBar({ value, failedPct, className }: { value: number; failedPct?: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  const failed = Math.min(100 - clamped, Math.max(0, failedPct || 0));
  return (
    <div className={cn("h-2 rounded-full bg-secondary overflow-hidden flex", className)}>
      <div
        className="h-full transition-all"
        style={{ width: `${clamped}%`, backgroundColor: STATUS_COLORS.completed }}
      />
      {failed > 0 && (
        <div
          className="h-full transition-all"
          style={{ width: `${failed}%`, backgroundColor: STATUS_COLORS.failed }}
        />
      )}
    </div>
  );
}

// ─── Section Card ───────────────────────────────────────────

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

// ─── Stat Card ──────────────────────────────────────────────

function StatCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      <div className="text-lg font-semibold" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ─── GCM Grid (PCB-style) ──────────────────────────────────

function GCMGrid({ scenarios }: { scenarios: ProjectionScenario[] }) {
  const [hoveredCell, setHoveredCell] = useState<{ scenario: string; gcm: string } | null>(null);
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);

  // Group scenarios by run_type
  const byRunType = useMemo(() => {
    const grouped: Record<string, ProjectionScenario[]> = {};
    for (const s of scenarios) {
      (grouped[s.run_type] ??= []).push(s);
    }
    return grouped;
  }, [scenarios]);

  if (scenarios.length === 0) {
    return <div className="text-sm text-muted-foreground">No scenario data available</div>;
  }

  return (
    <div className="space-y-6">
      {Object.entries(byRunType).map(([runType, typeScenarios]) => {
        // Collect all unique GCMs across scenarios in this run type
        const allGcms = new Set<string>();
        for (const s of typeScenarios) {
          for (const g of s.gcms) allGcms.add(g.gcm);
        }
        const gcmList = Array.from(allGcms).sort();

        return (
          <div key={runType}>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {runType}
            </div>

            {typeScenarios.map((scenario) => {
              const key = `${scenario.run_type}/${scenario.scenario}`;
              const isExpanded = expandedScenario === key;
              const p = scenario.progress;
              const t = scenario.timing;
              const gcmMap = new Map(scenario.gcms.map(g => [g.gcm, g]));

              return (
                <div key={key} className="mb-4">
                  {/* Scenario header */}
                  <button
                    onClick={() => setExpandedScenario(isExpanded ? null : key)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className="text-sm font-medium">{scenario.scenario}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.completed}/{p.expected}
                      </span>
                      <span className="text-xs font-medium" style={{ color: STATUS_COLORS.completed }}>
                        {formatPct(p.pct)}
                      </span>
                      {p.failed_gcms > 0 && (
                        <span className="text-xs" style={{ color: STATUS_COLORS.failed }}>
                          {p.failed_gcms} failed
                        </span>
                      )}
                      {scenario.jobs.running > 0 && (
                        <span className="text-xs" style={{ color: STATUS_COLORS.in_progress }}>
                          {scenario.jobs.running} running
                        </span>
                      )}
                      {t.eta_display && t.eta_display !== "n/a" && (
                        <span className="text-xs text-muted-foreground">
                          ETA: {t.eta_display}
                        </span>
                      )}
                      {t.rate_per_hour != null && (
                        <span className="text-xs text-muted-foreground">
                          ({t.rate_per_hour}/hr)
                        </span>
                      )}
                      <ChevronDown size={12} className={cn(
                        "text-muted-foreground transition-transform ml-auto",
                        isExpanded && "rotate-180"
                      )} />
                    </div>
                    <ProgressBar
                      value={p.pct}
                      failedPct={p.expected > 0 ? (p.failed_gcms / p.expected) * 100 : 0}
                    />
                  </button>

                  {/* GCM grid */}
                  {isExpanded && (
                    <div className="mt-3 relative">
                      <div className="flex flex-wrap gap-1">
                        {gcmList.map(gcmName => {
                          const gcm = gcmMap.get(gcmName);
                          const status = gcm?.status || "not_started";
                          const isHovered = hoveredCell?.scenario === key && hoveredCell?.gcm === gcmName;

                          return (
                            <div
                              key={gcmName}
                              className="relative group"
                              onMouseEnter={() => setHoveredCell({ scenario: key, gcm: gcmName })}
                              onMouseLeave={() => setHoveredCell(null)}
                            >
                              <div
                                className={cn(
                                  "w-6 h-6 rounded-sm border transition-all cursor-default",
                                  isHovered && "ring-2 ring-primary scale-125 z-10"
                                )}
                                style={{
                                  backgroundColor: STATUS_COLORS[status],
                                  borderColor: `${STATUS_COLORS[status]}80`,
                                  opacity: status === "not_started" ? 0.3 : 1,
                                }}
                              />
                              {/* Tooltip */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50">
                                <div className="bg-popover border border-border rounded-md shadow-lg px-3 py-2 text-xs whitespace-nowrap">
                                  <div className="font-medium">{gcmName}</div>
                                  <div style={{ color: STATUS_COLORS[status] }}>{STATUS_LABELS[status]}</div>
                                  {gcm && gcm.file_count > 0 && (
                                    <div className="text-muted-foreground">
                                      {gcm.file_count} files, {gcm.total_size_mb.toFixed(0)} MB
                                    </div>
                                  )}
                                  {gcm?.completed_at && (
                                    <div className="text-muted-foreground">{gcm.completed_at}</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Legend */}
                      <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
                        {(["completed", "in_progress", "failed", "not_started"] as const).map(s => {
                          const count = scenario.gcms.filter(g => g.status === s).length;
                          if (count === 0 && s !== "completed") return null;
                          return (
                            <div key={s} className="flex items-center gap-1">
                              <div className="w-2.5 h-2.5 rounded-sm" style={{
                                backgroundColor: STATUS_COLORS[s],
                                opacity: s === "not_started" ? 0.3 : 1,
                              }} />
                              {STATUS_LABELS[s]} ({count})
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── User Activity ──────────────────────────────────────────

function UserActivity({ report }: { report: ProjectionReport }) {
  const users = report.users;
  if (users.length === 0) return null;

  const userColorMap = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u, i) => map.set(u.user, getUserColor(i)));
    return map;
  }, [users]);

  return (
    <Section title="User Activity" icon={Users}>
      <div className="space-y-2">
        {users.map(u => {
          const color = userColorMap.get(u.user) || "#888";
          return (
            <div key={u.user} className="flex items-center gap-3 text-sm">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="font-medium w-28 truncate">{u.user}</span>
              <div className="flex gap-4 text-xs text-muted-foreground">
                {u.running > 0 && <span className="text-emerald-500">{u.running} running</span>}
                {u.pending > 0 && <span className="text-amber-500">{u.pending} pending</span>}
                <span>{u.cpus} CPUs</span>
                <span>{u.mem_gb} GB</span>
                {u.longest_elapsed && u.longest_elapsed !== "" && (
                  <span>longest: {u.longest_elapsed}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ─── Partition Status ───────────────────────────────────────

function PartitionStatus({ report }: { report: ProjectionReport }) {
  const parts = report.partitions;
  if (parts.length === 0) return null;

  return (
    <Section title="Partitions" icon={Cpu}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {parts.map(p => (
          <div key={p.name} className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {p.nodes.total} nodes ({p.nodes.idle} idle, {p.nodes.down} down)
              </span>
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-muted-foreground mb-0.5">
                <span>CPU</span>
                <span>{formatPct(p.cpus.pct)}</span>
              </div>
              <ProgressBar value={p.cpus.pct} />
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-muted-foreground mb-0.5">
                <span>Memory</span>
                <span>{formatPct(p.mem_gb.pct)}</span>
              </div>
              <ProgressBar value={p.mem_gb.pct} />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── Job History ────────────────────────────────────────────

function JobHistory({ report }: { report: ProjectionReport }) {
  const { failed, recently_completed } = report.job_history;
  const [showCompleted, setShowCompleted] = useState(false);

  if (failed.length === 0 && recently_completed.length === 0) return null;

  return (
    <Section
      title={`Job History (${report.job_history.period_hours}h)`}
      icon={Clock}
      headerRight={
        recently_completed.length > 0 ? (
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            {showCompleted ? "Hide completed" : `Show ${recently_completed.length} completed`}
          </button>
        ) : undefined
      }
    >
      {failed.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-red-500 mb-2 flex items-center gap-1">
            <XCircle size={12} /> Failed ({failed.length})
          </div>
          <JobTable jobs={failed} isFailed />
        </div>
      )}

      {showCompleted && recently_completed.length > 0 && (
        <div>
          <div className="text-xs font-medium text-emerald-500 mb-2 flex items-center gap-1">
            <CheckCircle2 size={12} /> Completed ({recently_completed.length})
          </div>
          <JobTable jobs={recently_completed.slice(0, 20)} />
        </div>
      )}
    </Section>
  );
}

function JobTable({ jobs, isFailed }: { jobs: ProjectionJobHistoryEntry[]; isFailed?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b border-border">
            <th className="text-left py-1 pr-2 font-medium">Job ID</th>
            <th className="text-left py-1 pr-2 font-medium">Name</th>
            <th className="text-left py-1 pr-2 font-medium">User</th>
            {isFailed && <th className="text-left py-1 pr-2 font-medium">State</th>}
            {isFailed && <th className="text-left py-1 pr-2 font-medium">Exit</th>}
            <th className="text-left py-1 pr-2 font-medium">Elapsed</th>
            <th className="text-left py-1 font-medium">End</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map(j => (
            <tr key={j.job_id} className="border-b border-border/50">
              <td className="py-1 pr-2 font-mono">{j.job_id}</td>
              <td className="py-1 pr-2 truncate max-w-[200px]">{j.name}</td>
              <td className="py-1 pr-2">{j.user}</td>
              {isFailed && (
                <td className="py-1 pr-2" style={{ color: STATUS_COLORS.failed }}>{j.state}</td>
              )}
              {isFailed && <td className="py-1 pr-2 font-mono">{j.exit_code}</td>}
              <td className="py-1 pr-2">{j.elapsed}</td>
              <td className="py-1 text-muted-foreground">{j.end}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Overall Progress Summary ───────────────────────────────

function OverallProgress({ report }: { report: ProjectionReport }) {
  const scenarios = report.scenarios;

  const totals = useMemo(() => {
    let completed = 0, expected = 0, failed = 0, running = 0, pending = 0;
    for (const s of scenarios) {
      completed += s.progress.completed;
      expected += s.progress.expected;
      failed += s.progress.failed_gcms;
      running += s.jobs.running;
      pending += s.jobs.pending;
    }
    const pct = expected > 0 ? (completed / expected) * 100 : 0;
    return { completed, expected, failed, running, pending, pct };
  }, [scenarios]);

  return (
    <Section title="Overall Progress" icon={Activity}>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 sm:gap-6 mb-4">
        <StatCard label="Completed" value={totals.completed} color={STATUS_COLORS.completed} />
        <StatCard label="Expected" value={totals.expected} />
        <StatCard label="Running" value={totals.running} color={STATUS_COLORS.in_progress} />
        <StatCard label="Pending" value={totals.pending} />
        <StatCard label="Failed GCMs" value={totals.failed} color={totals.failed > 0 ? STATUS_COLORS.failed : undefined} />
        <StatCard label="Progress" value={formatPct(totals.pct)} color={STATUS_COLORS.completed} />
      </div>
      <ProgressBar
        value={totals.pct}
        failedPct={totals.expected > 0 ? (totals.failed / totals.expected) * 100 : 0}
      />
    </Section>
  );
}

// ─── Summary Stats ──────────────────────────────────────────

function SummaryStats({ report }: { report: ProjectionReport }) {
  const s = report.summary;
  return (
    <Section title="Compute Usage" icon={Cpu}>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-6">
        <StatCard label="Running Jobs" value={s.total_running} color="#059669" />
        <StatCard label="Pending Jobs" value={s.total_pending} color="#d97706" />
        <StatCard label="CPUs in Use" value={s.total_cpus} />
        <StatCard label="Memory" value={`${s.total_mem_gb} GB`} />
        <StatCard
          label="Longest Job"
          value={s.longest_elapsed}
          sub={s.partitions_in_use.length > 0 ? `on ${s.partitions_in_use.join(", ")}` : undefined}
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 mt-4 pt-4 border-t border-border">
        <StatCard label="NC4 Files" value={s.total_nc4_files.toLocaleString()} />
        <StatCard label="Output Size" value={s.total_output_size} />
        <StatCard label="Failed (24h)" value={s.total_failed_recent} color={s.total_failed_recent > 0 ? STATUS_COLORS.failed : undefined} />
        <StatCard label="Completed (24h)" value={s.total_completed_recent} color={STATUS_COLORS.completed} />
      </div>
    </Section>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────

export function ProjectionsDashboard() {
  const [report, setReport] = useState<ProjectionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await getProjectionReport();
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
        <div className="text-sm text-foreground mb-1">Could not load projection data</div>
        <div className="text-xs text-muted-foreground mb-3">{error}</div>
        <button onClick={() => fetchReport()} className="text-xs text-primary hover:underline">Try again</button>
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="border border-border rounded-lg bg-card p-6 text-center">
        <RefreshCw className="mx-auto mb-2 text-muted-foreground animate-spin" size={24} />
        <div className="text-sm text-muted-foreground">Loading projection data...</div>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium">
            Projection Monitor
            <span className="text-muted-foreground font-normal ml-2">
              {report.meta.account}
            </span>
          </h2>
          {report.meta.timestamp && (
            <span className="text-[10px] text-muted-foreground">
              {timeAgo(report.meta.timestamp)}
            </span>
          )}
          {error && (
            <span className="text-[10px] text-amber-500">stale data</span>
          )}
        </div>
        <button
          onClick={() => fetchReport(true)}
          disabled={refreshing}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Overall progress */}
      <OverallProgress report={report} />

      {/* GCM completion grid */}
      <Section title="GCM Completion Grid" icon={HardDrive}>
        <GCMGrid scenarios={report.scenarios} />
      </Section>

      {/* Compute usage */}
      <SummaryStats report={report} />

      {/* User activity + Partitions side by side on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <UserActivity report={report} />
        <PartitionStatus report={report} />
      </div>

      {/* Job history */}
      <JobHistory report={report} />
    </div>
  );
}
