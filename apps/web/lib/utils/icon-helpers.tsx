import {
  Folder,
  FolderOpen,
  File,
  FileText,
  Image,
  Film,
  Archive,
  Code,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Get size-based severity color (semantic traffic light scale)
 * Shared between Tree and Voronoi views for consistent data visualization
 */
export function getSizeColor(sizeBytes: number): string {
  const sizeGB = sizeBytes / (1024 ** 3);
  if (sizeGB >= 50) return "text-red-500";         // ≥50GB: red (very large)
  if (sizeGB >= 10) return "text-orange-400";      // ≥10GB: orange (large)
  if (sizeGB >= 1) return "text-yellow-400";       // ≥1GB: yellow (medium)
  if (sizeGB >= 0.01) return "text-green-400";     // ≥10MB: green (small)
  return "text-muted-foreground/40";               // <10MB: near-white (negligible)
}

/**
 * Get fill color (hex) for size-based coloring (for D3/SVG rendering)
 */
export function getSizeFillColor(sizeBytes: number): string {
  const sizeGB = sizeBytes / (1024 ** 3);
  if (sizeGB >= 50) return "#ef4444";         // red-500
  if (sizeGB >= 10) return "#fb923c";         // orange-400
  if (sizeGB >= 1) return "#facc15";          // yellow-400
  if (sizeGB >= 0.01) return "#4ade80";       // green-400
  return "#9ca3af";                           // gray-400 (negligible)
}

/**
 * Get file icon based on extension with size-based coloring
 */
export function getFileIcon(name: string, _fileType: string | undefined, sizeBytes: number) {
  const ext = name.split(".").pop()?.toLowerCase();
  const colorClass = getSizeColor(sizeBytes);

  // Scientific data files (NetCDF, HDF5, Zarr)
  if (["nc", "nc4", "netcdf", "hdf", "hdf5", "h5", "he5", "zarr"].includes(ext || "")) {
    return <Database className={cn("w-3.5 h-3.5", colorClass)} />;
  }
  // Tabular data (CSV, TSV, Parquet, Feather)
  if (["csv", "tsv", "parquet", "feather", "arrow"].includes(ext || "")) {
    return <Database className={cn("w-3.5 h-3.5", colorClass)} />;
  }
  // Statistical software files (Stata, R, SPSS, SAS)
  if (["dta", "r", "rdata", "rds", "sav", "sas7bdat"].includes(ext || "")) {
    return <Code className={cn("w-3.5 h-3.5", colorClass)} />;
  }
  // Code files (Python, Julia, MATLAB, Shell)
  if (["py", "jl", "m", "sh", "bash", "zsh", "js", "ts", "tsx", "jsx", "cpp", "c", "h", "java", "rs", "go"].includes(ext || "")) {
    return <Code className={cn("w-3.5 h-3.5", colorClass)} />;
  }
  // Archives
  if (["zip", "tar", "gz", "bz2", "7z", "rar", "xz", "tgz", "tbz2"].includes(ext || "")) {
    return <Archive className={cn("w-3.5 h-3.5", colorClass)} />;
  }
  // Images
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "tiff", "tif"].includes(ext || "")) {
    // eslint-disable-next-line jsx-a11y/alt-text
    return <Image className={cn("w-3.5 h-3.5", colorClass)} />;
  }
  // Video
  if (["mp4", "avi", "mkv", "mov", "wmv", "flv", "webm"].includes(ext || "")) {
    return <Film className={cn("w-3.5 h-3.5", colorClass)} />;
  }
  // Structured data (JSON, XML, YAML)
  if (["json", "xml", "yaml", "yml", "toml"].includes(ext || "")) {
    return <Database className={cn("w-3.5 h-3.5", colorClass)} />;
  }
  // Text
  if (["txt", "md", "log", "cfg", "conf", "ini", "env", "readme"].includes(ext || "")) {
    return <FileText className={cn("w-3.5 h-3.5", colorClass)} />;
  }

  return <File className={cn("w-3.5 h-3.5", colorClass)} />;
}

/**
 * Get folder icon with size-based coloring
 */
export function getFolderIcon(sizeBytes: number, isOpen: boolean = false) {
  const colorClass = getSizeColor(sizeBytes);
  return isOpen
    ? <FolderOpen className={cn("w-3.5 h-3.5", colorClass)} />
    : <Folder className={cn("w-3.5 h-3.5", colorClass)} />;
}
