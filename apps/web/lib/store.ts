import { create } from "zustand";

interface AppState {
  selectedSnapshot: string | null;
  selectedPath: string;
  setSelectedSnapshot: (snapshot: string | null) => void;
  setSelectedPath: (path: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedSnapshot: null,
  selectedPath: "/",
  setSelectedSnapshot: (snapshot) => set({ selectedSnapshot: snapshot }),
  setSelectedPath: (path) => set({ selectedPath: path }),
}));
