"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";

interface FileTypeData {
  name: string;
  value: number;
  color: string;
}

interface FileTypeTreemapProps {
  data: FileTypeData[];
  width?: number;
  height?: number;
}

export function FileTypeTreemap({ data, width = 200, height = 120 }: FileTypeTreemapProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    // Clear previous content
    d3.select(svgRef.current).selectAll("*").remove();

    // Create hierarchy
    const root = d3.hierarchy({ name: "root", children: data } as any)
      .sum(d => (d as any).value)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    // Create treemap layout
    const treemap = d3.treemap<any>()
      .size([width, height])
      .padding(1)
      .round(true);

    treemap(root);

    const svg = d3.select(svgRef.current);

    // Create cells
    const cell = svg.selectAll("g")
      .data(root.leaves())
      .join("g")
      .attr("transform", d => `translate(${d.x0},${d.y0})`);

    // Add rectangles
    cell.append("rect")
      .attr("width", d => d.x1 - d.x0)
      .attr("height", d => d.y1 - d.y0)
      .attr("fill", d => d.data.color)
      .attr("stroke", "hsl(var(--border))")
      .attr("stroke-width", 0.5)
      .attr("opacity", 0.8);

    // Add labels for larger cells
    cell.append("text")
      .attr("x", d => (d.x1 - d.x0) / 2)
      .attr("y", d => (d.y1 - d.y0) / 2)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", "9px")
      .attr("font-family", "monospace")
      .attr("fill", "hsl(var(--foreground))")
      .attr("opacity", 0.9)
      .text(d => {
        const cellWidth = d.x1 - d.x0;
        const cellHeight = d.y1 - d.y0;
        // Only show label if cell is large enough
        if (cellWidth > 30 && cellHeight > 15) {
          return d.data.name;
        }
        return "";
      });

    // Add tooltips (title elements)
    cell.append("title")
      .text(d => {
        const percent = ((d.value || 0) / (root.value || 1)) * 100;
        const sizeGB = (d.value || 0) / (1024 ** 3);
        return `${d.data.name}\n${sizeGB.toFixed(2)} GB\n${percent.toFixed(1)}%`;
      });

  }, [data, width, height]);

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground/40"
        style={{ width, height }}
      >
        No data
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="rounded-sm border border-border/30"
    />
  );
}
