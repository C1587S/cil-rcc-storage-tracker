import { create } from "zustand";

interface AppState {
  selectedSnapshot: string | null;
  selectedPath: string;
  referencePath: string;  // Shared reference directory for both Tree and Voronoi views
  referenceSize: number | null;  // Size of reference directory for percentage calculations
  setSelectedSnapshot: (snapshot: string | null) => void;
  setSelectedPath: (path: string) => void;
  setReferencePath: (path: string) => void;
  setReferenceSize: (size: number | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedSnapshot: null,
  selectedPath: "/",
  referencePath: "/project/cil",  // Default reference directory
  referenceSize: null,
  setSelectedSnapshot: (snapshot) => set({ selectedSnapshot: snapshot }),
  setSelectedPath: (path) => set({ selectedPath: path }),
  setReferencePath: (path) => set({ referencePath: path }),
  setReferenceSize: (size) => set({ referenceSize: size }),
}));
