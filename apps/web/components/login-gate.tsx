"use client";

import { useState, useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store";
import { validateUser } from "@/lib/api";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";
import { LogOut } from "lucide-react";

export function LoginGate({ children }: { children: React.ReactNode }) {
  const { currentUser, setCurrentUser, setTheme } = useAppStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Force dark mode on the login screen
  useEffect(() => {
    if (mounted && !currentUser) {
      setTheme("dark");
    }
  }, [mounted, currentUser, setTheme]);

  // Avoid hydration mismatch — render nothing until client-side
  if (!mounted) return null;

  if (currentUser) return <>{children}</>;

  const handleLogin = (user: string) => {
    setCurrentUser(user);
    setTheme("light");
  };

  return <LoginScreen onLogin={handleLogin} />;
}

/** Logout button for the navbar */
export function LogoutButton() {
  const { currentUser, logout } = useAppStore();
  if (!currentUser) return null;

  return (
    <button
      onClick={logout}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      title={`Logged in as ${currentUser}`}
    >
      <span className="font-mono">{currentUser}</span>
      <LogOut size={13} />
    </button>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: string) => void }) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim().toLowerCase();
    if (!trimmed) return;

    setLoading(true);
    setError("");

    try {
      const result = await validateUser(trimmed);
      if (result.valid) {
        onLogin(result.username);
      }
    } catch {
      setError("Username not recognized. Use your RCC username or the name part of your institutional email.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      {/* Same header as the dashboard */}
      <nav className="border-b border-border bg-card">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <img
                src="/cil-rcc-tracker/cil_rcc_console.png"
                alt="CRC"
                width={28}
                height={28}
                className="rounded-full w-6 h-6 sm:w-7 sm:h-7"
              />
              <h1 className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
                CIL RCC <span className="font-normal text-muted-foreground">Console</span>
              </h1>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      {/* Login form */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6 sm:mb-8">
            <img
              src="/cil-rcc-tracker/cil_rcc_console.png"
              alt="CIL RCC Console"
              width={64}
              height={64}
              className="mx-auto mb-4 sm:mb-5 rounded-xl shadow-sm logo-spin-once w-12 h-12 sm:w-16 sm:h-16"
            />
            <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-2">Sign in</h2>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Enter your RCC username — the one you use to log in on Midway.
              <br />
              If you don't have an RCC account, use the name part of the email you use on the CIL Slack
              <br />
              <span className="text-muted-foreground/60">(the part before the @)</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
            <div>
              <input
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(""); }}
                placeholder="username"
                autoFocus
                autoComplete="username"
                className={cn(
                  "w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg border text-sm font-mono",
                  "bg-secondary/50 text-foreground placeholder:text-muted-foreground/50",
                  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
                  "transition-colors",
                  error ? "border-red-400" : "border-border"
                )}
              />
              {error && (
                <p className="mt-2 text-xs text-red-500">{error}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !username.trim()}
              className={cn(
                "w-full py-2.5 sm:py-3 rounded-lg text-sm font-medium transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {loading ? "Checking..." : "Continue"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
