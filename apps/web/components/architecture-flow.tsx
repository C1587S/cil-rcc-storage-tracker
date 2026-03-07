"use client";

import { memo, useCallback } from "react";
import ReactFlow, {
  Node,
  Edge,
  Position,
  Handle,
  NodeProps,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  ScanLine,
  FileSpreadsheet,
  Globe,
  Download,
  Database,
  Server,
  Monitor,
  Cloud,
  Brain,
  User,
  Timer,
  CircleCheckBig,
  RotateCcw,
} from "lucide-react";
import { useAppStore } from "@/lib/store";

// ─── Custom Node ─────────────────────────────────────────────

interface CustomNodeData {
  icon: string;
  label: string;
  sublabel?: string;
  accent?: "primary" | "teal" | "orange" | "violet";
  badge?: string;
  tool?: string;
}

const ICONS: Record<string, React.ElementType> = {
  scan: ScanLine, file: FileSpreadsheet, globe: Globe, download: Download,
  database: Database, server: Server, monitor: Monitor, cloud: Cloud,
  brain: Brain, user: User, timer: Timer, check: CircleCheckBig,
};

const NODE_STYLES: Record<string, { border: string; bg: string; icon: string; badgeBg: string; badgeText: string }> = {
  primary: {
    border: "1px solid hsl(213 76% 55% / 0.4)",
    bg: "hsl(213 76% 55% / 0.06)",
    icon: "hsl(213 76% 55%)",
    badgeBg: "hsl(213 76% 55% / 0.12)",
    badgeText: "hsl(213 76% 55%)",
  },
  teal: {
    border: "1px solid hsl(172 50% 42% / 0.4)",
    bg: "hsl(172 50% 42% / 0.06)",
    icon: "hsl(172 50% 42%)",
    badgeBg: "hsl(172 50% 42% / 0.12)",
    badgeText: "hsl(172 50% 42%)",
  },
  orange: {
    border: "1px solid hsl(25 85% 55% / 0.4)",
    bg: "hsl(25 85% 55% / 0.06)",
    icon: "hsl(25 85% 55%)",
    badgeBg: "hsl(25 85% 55% / 0.12)",
    badgeText: "hsl(25 85% 55%)",
  },
  violet: {
    border: "1px solid hsl(270 50% 55% / 0.4)",
    bg: "hsl(270 50% 55% / 0.06)",
    icon: "hsl(270 50% 55%)",
    badgeBg: "hsl(270 50% 55% / 0.12)",
    badgeText: "hsl(270 50% 55%)",
  },
};

const CustomNode = memo(({ data }: NodeProps<CustomNodeData>) => {
  const s = NODE_STYLES[data.accent || "primary"];
  const Icon = ICONS[data.icon] || Server;
  const handleStyle = { background: "hsl(var(--border))", width: 5, height: 5, border: "none" };

  return (
    <div
      style={{ border: s.border, background: s.bg }}
      className="relative px-4 py-3 rounded-xl min-w-[110px] text-center transition-shadow hover:shadow-md cursor-grab active:cursor-grabbing"
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <Handle type="source" position={Position.Right} style={handleStyle} />
      <Handle type="target" position={Position.Top} id="top" style={handleStyle} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={handleStyle} />

      {data.badge && (
        <span
          style={{ background: s.badgeBg, color: s.badgeText }}
          className="absolute -top-2 right-2 text-[8px] font-bold px-1.5 py-[1px] rounded-full uppercase tracking-widest"
        >
          {data.badge}
        </span>
      )}

      <div className="flex flex-col items-center gap-1">
        <Icon size={18} style={{ color: s.icon }} strokeWidth={1.5} />
        <span className="text-[11px] font-semibold text-foreground leading-tight">{data.label}</span>
        {data.sublabel && (
          <span className="text-[9px] text-muted-foreground leading-tight">{data.sublabel}</span>
        )}
        {data.tool && (
          <span className="text-[8px] font-mono text-muted-foreground/50 mt-0.5">{data.tool}</span>
        )}
      </div>
    </div>
  );
});
CustomNode.displayName = "CustomNode";

// ─── Zone Group Node ─────────────────────────────────────────

interface ZoneData {
  label: string;
  color: "orange" | "primary" | "teal" | "violet";
}

const ZONE_STYLES: Record<string, { border: string; bg: string; text: string }> = {
  orange: { border: "2px dashed hsl(25 85% 55% / 0.25)", bg: "hsl(25 85% 55% / 0.03)", text: "hsl(25 85% 55% / 0.5)" },
  primary: { border: "2px dashed hsl(213 76% 55% / 0.25)", bg: "hsl(213 76% 55% / 0.03)", text: "hsl(213 76% 55% / 0.5)" },
  teal: { border: "2px dashed hsl(172 50% 42% / 0.25)", bg: "hsl(172 50% 42% / 0.03)", text: "hsl(172 50% 42% / 0.5)" },
  violet: { border: "2px dashed hsl(270 50% 55% / 0.25)", bg: "hsl(270 50% 55% / 0.03)", text: "hsl(270 50% 55% / 0.5)" },
};

const ZoneNode = memo(({ data }: NodeProps<ZoneData>) => {
  const c = ZONE_STYLES[data.color] || ZONE_STYLES.primary;
  return (
    <div style={{ border: c.border, background: c.bg, width: "100%", height: "100%", borderRadius: "16px" }}>
      <span style={{ color: c.text }} className="absolute top-2.5 left-3.5 text-[9px] font-bold uppercase tracking-widest">
        {data.label}
      </span>
    </div>
  );
});
ZoneNode.displayName = "ZoneNode";

const nodeTypes = { custom: CustomNode, zone: ZoneNode };

// ─── Edge styles ─────────────────────────────────────────────

const ePrimary = { stroke: "hsl(213,76%,55%)", strokeWidth: 1.5 };
const eTeal = { stroke: "hsl(172,50%,42%)", strokeWidth: 1.5 };
const eOrange = { stroke: "hsl(25,85%,55%)", strokeWidth: 1.5, strokeDasharray: "6 3" };
const eDashed = { ...ePrimary, strokeDasharray: "4 3" };
const lPrimary = { fontSize: 9, fill: "hsl(213,76%,55%)" };
const lTeal = { fontSize: 9, fill: "hsl(172,50%,42%)" };

// ─── Architecture Diagram ────────────────────────────────────
// Nodes are centered within their zones. Zone label takes ~28px from top.
// Node approx size: ~145w x ~90h. Padding: 30px horizontal, 20px below label.

const archNodes: Node[] = [
  // Zones
  { id: "zone-rcc", type: "zone", position: { x: 0, y: 0 }, style: { width: 540, height: 155, zIndex: -1 },
    data: { label: "RCC Cluster (Midway)", color: "orange" }, draggable: false, selectable: false },
  { id: "zone-local", type: "zone", position: { x: 560, y: 0 }, style: { width: 540, height: 155, zIndex: -1 },
    data: { label: "Local Server (Docker)", color: "primary" }, draggable: false, selectable: false },
  { id: "zone-public", type: "zone", position: { x: 1120, y: -195 }, style: { width: 185, height: 370, zIndex: -1 },
    data: { label: "Public Internet", color: "violet" }, draggable: false, selectable: false },

  // RCC nodes — centered in zone (zone x:0, w:540 → content 30..510, 3 nodes ~145w, gaps ~25)
  { id: "scanner", type: "custom", position: { x: 30, y: 48 },
    data: { icon: "scan", label: "Scanner", sublabel: "caslake, Midway3", accent: "orange", badge: "SLURM", tool: "Rust" } },
  { id: "parquet", type: "custom", position: { x: 195, y: 48 },
    data: { icon: "file", label: "Parquet Files", sublabel: "/scratch/midway3/", accent: "orange", tool: "Apache Parquet" } },
  { id: "http", type: "custom", position: { x: 370, y: 48 },
    data: { icon: "globe", label: "public_html", sublabel: "Midway2 HTTP", accent: "orange" } },

  // Local nodes — centered in zone (zone x:560, w:540 → content 590..1070)
  { id: "download", type: "custom", position: { x: 590, y: 48 },
    data: { icon: "download", label: "Download", sublabel: "Validate, cron 3x/day", accent: "primary", tool: "Polars" } },
  { id: "clickhouse", type: "custom", position: { x: 755, y: 48 },
    data: { icon: "database", label: "ClickHouse", sublabel: "72M rows, <100ms", accent: "primary", badge: "DB", tool: "Docker" } },
  { id: "api", type: "custom", position: { x: 920, y: 48 },
    data: { icon: "server", label: "FastAPI", sublabel: "REST API", accent: "primary", tool: "Python / Docker" } },

  // Public zone nodes — centered horizontally (zone x:1120, w:185 → center ~1212, node ~145w → x:1140)
  { id: "dashboard", type: "custom", position: { x: 1140, y: 48 },
    data: { icon: "monitor", label: "Dashboard", sublabel: "Next.js", accent: "primary", badge: "WEB", tool: "Docker" } },

  // AI branch (above clickhouse)
  { id: "ai", type: "custom", position: { x: 755, y: -80 },
    data: { icon: "brain", label: "llama-3.3-70b", sublabel: "Local, no data sharing", accent: "teal", badge: "AI" } },

  // Public zone — tunnel and user (centered in zone)
  { id: "tunnel", type: "custom", position: { x: 1140, y: -70 },
    data: { icon: "cloud", label: "Cloudflare", sublabel: "Tunnel + HTTPS", accent: "violet", tool: "cloudflared" } },
  { id: "user", type: "custom", position: { x: 1140, y: -170 },
    data: { icon: "user", label: "You", sublabel: "Browser", accent: "violet" } },
];

const archEdges: Edge[] = [
  { id: "e1", source: "scanner", target: "parquet", animated: true, style: eOrange },
  { id: "e2", source: "parquet", target: "http", style: eOrange },
  { id: "e3", source: "http", target: "download", animated: true, style: ePrimary, label: "HTTP", labelStyle: lPrimary },
  { id: "e4", source: "download", target: "clickhouse", style: ePrimary },
  { id: "e5", source: "clickhouse", target: "api", style: ePrimary },
  { id: "e6", source: "api", target: "dashboard", style: ePrimary },
  { id: "e7", source: "dashboard", target: "tunnel", sourceHandle: "top", targetHandle: "bottom", style: ePrimary },
  { id: "e8", source: "ai", target: "api", sourceHandle: "bottom", targetHandle: "top", style: eTeal, label: "SQL", labelStyle: lTeal },
  { id: "e9", source: "user", target: "tunnel", targetHandle: "top", sourceHandle: "bottom", style: eDashed, label: "HTTPS", labelStyle: lPrimary },
];

// ─── Pipeline Diagram ────────────────────────────────────────
// Horizontal layout, nodes centered in zones.

const pipeNodes: Node[] = [
  // Zones
  { id: "pz-rcc", type: "zone", position: { x: 0, y: 0 }, style: { width: 720, height: 130, zIndex: -1 },
    data: { label: "RCC (Midway3 + Midway2)", color: "orange" }, draggable: false, selectable: false },
  { id: "pz-local", type: "zone", position: { x: 740, y: 0 }, style: { width: 530, height: 130, zIndex: -1 },
    data: { label: "Local Server", color: "primary" }, draggable: false, selectable: false },

  // RCC pipeline nodes — centered vertically in zone (zone h:130, label ~28px, node ~80h → y = 28 + (130-28-80)/2 ≈ 39)
  { id: "p1", type: "custom", position: { x: 25, y: 35 },
    data: { icon: "timer", label: "1. Slurm Job", sublabel: "Daily at 2 AM", accent: "orange", tool: "caslake" } },
  { id: "p2", type: "custom", position: { x: 195, y: 35 },
    data: { icon: "scan", label: "2. Scan", sublabel: "7 dirs in parallel", accent: "orange", tool: "Rust" } },
  { id: "p3", type: "custom", position: { x: 365, y: 35 },
    data: { icon: "file", label: "3. Parquet", sublabel: "7 files, ~1.5 GB", accent: "orange", tool: "scratch/midway3" } },
  { id: "p4", type: "custom", position: { x: 540, y: 35 },
    data: { icon: "globe", label: "4. Publish", sublabel: "public_html", accent: "orange", tool: "Midway2" } },

  // Local pipeline nodes
  { id: "p5", type: "custom", position: { x: 765, y: 35 },
    data: { icon: "download", label: "5. Download", sublabel: "Validate w/ Polars", accent: "primary" } },
  { id: "p6", type: "custom", position: { x: 935, y: 35 },
    data: { icon: "database", label: "6. Import", sublabel: "Create snapshot", accent: "primary", tool: "ClickHouse" } },
  { id: "p7", type: "custom", position: { x: 1105, y: 35 },
    data: { icon: "check", label: "7. Ready", sublabel: "Query via dashboard", accent: "teal" } },
];

const pipeEdges: Edge[] = [
  { id: "pe1", source: "p1", target: "p2", animated: true, style: eOrange },
  { id: "pe2", source: "p2", target: "p3", style: eOrange },
  { id: "pe3", source: "p3", target: "p4", style: eOrange },
  { id: "pe4", source: "p4", target: "p5", animated: true, style: ePrimary },
  { id: "pe5", source: "p5", target: "p6", style: ePrimary },
  { id: "pe6", source: "p6", target: "p7", style: eTeal },
];

// ─── Theme-aware backgrounds ─────────────────────────────────

const BG_LIGHT = "#ededeb";
const BG_DARK = "#1a1a1a";
const DOT_LIGHT = "#d0d0cc";
const DOT_DARK = "#2a2a2a";

// ─── Flow Diagram with Reset ────────────────────────────────

function FlowInner({ initialNodes, initialEdges, height, isDark }: {
  initialNodes: Node[]; initialEdges: Edge[]; height: number; isDark: boolean;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const { fitView } = useReactFlow();

  const handleReset = useCallback(() => {
    setNodes(initialNodes.map(n => ({ ...n })));
    setTimeout(() => fitView({ padding: 0.12, duration: 300 }), 50);
  }, [initialNodes, setNodes, fitView]);

  return (
    <>
      <button
        onClick={handleReset}
        className="absolute top-2 right-3 z-10 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        title="Reset layout"
      >
        <RotateCcw size={13} />
      </button>
      <div style={{ height }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          nodesDraggable={true}
          nodesConnectable={false}
          zoomOnScroll={false}
          panOnScroll={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          style={{ background: isDark ? BG_DARK : BG_LIGHT }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color={isDark ? DOT_DARK : DOT_LIGHT}
          />
        </ReactFlow>
      </div>
    </>
  );
}

function FlowDiagram({ title, nodes, edges, height = 220 }: {
  title: string; nodes: Node[]; edges: Edge[]; height?: number;
}) {
  const theme = useAppStore((s) => s.theme);
  const isDark = theme === "dark";

  return (
    <div className="border border-border rounded-lg overflow-hidden relative">
      <div className="px-4 py-2.5 border-b border-border" style={{ background: isDark ? BG_DARK : BG_LIGHT }}>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
      </div>
      <ReactFlowProvider>
        <FlowInner initialNodes={nodes} initialEdges={edges} height={height} isDark={isDark} />
      </ReactFlowProvider>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────

export function ArchitectureFlow() {
  return (
    <div className="space-y-6">
      <FlowDiagram title="System Architecture" nodes={archNodes} edges={archEdges} height={360} />
      <FlowDiagram title="Data Pipeline -- scan to screen" nodes={pipeNodes} edges={pipeEdges} height={200} />
    </div>
  );
}
