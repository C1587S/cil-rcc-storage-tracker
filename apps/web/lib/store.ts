import { create } from "zustand";

interface AppState {
  selectedSnapshot: string | null;
  selectedPath: string;
  referencePath: string;  // Shared reference directory for both Tree and Voronoi views
  referenceSize: number | null;  // Size of reference directory for percentage calculations
  isVoronoiFullscreen: boolean;  // Track if Voronoi is in fullscreen mode
  highlightColor: string;  // Highlight color for Voronoi partitions
  theme: 'dark' | 'light';  // Theme mode
  setSelectedSnapshot: (snapshot: string | null) => void;
  setSelectedPath: (path: string) => void;
  setReferencePath: (path: string) => void;
  setReferenceSize: (size: number | null) => void;
  setVoronoiFullscreen: (isFullscreen: boolean) => void;
  setHighlightColor: (color: string) => void;
  setTheme: (theme: 'dark' | 'light') => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedSnapshot: null,
  selectedPath: "/",
  referencePath: "/project/cil",  // Default reference directory
  referenceSize: null,
  isVoronoiFullscreen: false,
  highlightColor: "#f3e5ab",  // Default: Vanilla
  theme: 'dark',  // Default: dark mode
  setSelectedSnapshot: (snapshot) => set({ selectedSnapshot: snapshot }),
  setSelectedPath: (path) => set({ selectedPath: path }),
  setReferencePath: (path) => set({ referencePath: path }),
  setReferenceSize: (size) => set({ referenceSize: size }),
  setVoronoiFullscreen: (isFullscreen) => set({ isVoronoiFullscreen: isFullscreen }),
  setHighlightColor: (color) => set({ highlightColor: color }),
  setTheme: (theme) => set({ theme }),
}));
