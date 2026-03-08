import { create } from "zustand";

interface AppState {
  selectedSnapshot: string | null;
  selectedPath: string;
  referencePath: string;  // Shared reference directory for both Tree and Voronoi views
  referenceSize: number | null;  // Size of reference directory for percentage calculations
  isVoronoiFullscreen: boolean;  // Track if Voronoi is in fullscreen mode
  highlightColor: string;  // Highlight color for Voronoi partitions
  theme: 'dark' | 'light';  // Theme mode
  currentUser: string | null;  // Logged-in username (persisted in localStorage)
  setSelectedSnapshot: (snapshot: string | null) => void;
  setSelectedPath: (path: string) => void;
  setReferencePath: (path: string) => void;
  setReferenceSize: (size: number | null) => void;
  setVoronoiFullscreen: (isFullscreen: boolean) => void;
  setHighlightColor: (color: string) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setCurrentUser: (user: string | null) => void;
  logout: () => void;
}

function loadUser(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('cil-user');
}

export const useAppStore = create<AppState>((set) => ({
  selectedSnapshot: null,
  selectedPath: "/",
  referencePath: "/project/cil",  // Default reference directory
  referenceSize: null,
  isVoronoiFullscreen: false,
  highlightColor: "#f3e5ab",  // Default: Vanilla
  theme: 'light',  // Default: light mode
  currentUser: loadUser(),
  setSelectedSnapshot: (snapshot) => set({ selectedSnapshot: snapshot }),
  setSelectedPath: (path) => set({ selectedPath: path }),
  setReferencePath: (path) => set({ referencePath: path }),
  setReferenceSize: (size) => set({ referenceSize: size }),
  setVoronoiFullscreen: (isFullscreen) => set({ isVoronoiFullscreen: isFullscreen }),
  setHighlightColor: (color) => set({ highlightColor: color }),
  setTheme: (theme) => set({ theme }),
  setCurrentUser: (user) => {
    if (user) localStorage.setItem('cil-user', user);
    else localStorage.removeItem('cil-user');
    set({ currentUser: user });
  },
  logout: () => {
    localStorage.removeItem('cil-user');
    set({ currentUser: null });
  },
}));
