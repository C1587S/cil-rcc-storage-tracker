"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Search, Database, Code } from "lucide-react";
import { cn } from "@/lib/utils";

type ConsoleMode = "filters" | "guided" | "sql";

export function SearchConsole() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [mode, setMode] = useState<ConsoleMode>("filters");

  return (
    <Card className="border-t-2 border-border/50">
      <CardHeader
        className="cursor-pointer hover:bg-muted/5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-muted-foreground">
            Search & Query Console
          </CardTitle>
          <Button variant="ghost" size="sm">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Mode tabs */}
          <div className="flex items-center gap-2 border-b border-border/30 pb-3">
            <button
              onClick={() => setMode("filters")}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded-sm transition-colors",
                mode === "filters"
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:bg-muted/20"
              )}
            >
              <Search className="h-3.5 w-3.5" />
              Filter Builder
            </button>
            <button
              onClick={() => setMode("guided")}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded-sm transition-colors",
                mode === "guided"
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:bg-muted/20"
              )}
            >
              <Database className="h-3.5 w-3.5" />
              Guided SQL
            </button>
            <button
              onClick={() => setMode("sql")}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded-sm transition-colors",
                mode === "sql"
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:bg-muted/20"
              )}
            >
              <Code className="h-3.5 w-3.5" />
              Raw SQL
            </button>
          </div>

          {/* Mode content */}
          {mode === "filters" && <div className="text-xs text-muted-foreground">Filter Builder - Coming soon</div>}
          {mode === "guided" && <div className="text-xs text-muted-foreground">Guided SQL - Coming soon</div>}
          {mode === "sql" && <div className="text-xs text-muted-foreground">Raw SQL - Coming soon</div>}
        </CardContent>
      )}
    </Card>
  );
}
