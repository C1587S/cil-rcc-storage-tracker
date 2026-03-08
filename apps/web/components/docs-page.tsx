"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DOC_SECTIONS } from "@/lib/docs-content";
import { ArchitectureFlow } from "./architecture-flow";
import { FeedbackSection } from "./feedback-section";
import { useAppStore } from "@/lib/store";

const basePath = "/cil-rcc-tracker";

// Theme-aware image map: "theme:<key>" src convention
const THEME_IMAGES: Record<string, { light: string; dark: string }> = {
  voronoi: {
    light: `${basePath}/docs/voronoi_light.png`,
    dark: `${basePath}/docs/voronoi_dark.png`,
  },
  tree: {
    light: `${basePath}/docs/cil_rcc_tree_ligth.png`,
    dark: `${basePath}/docs/cil_rcc_tree_dark.png`,
  },
  query: {
    light: `${basePath}/docs/query_console_light.png`,
    dark: `${basePath}/docs/query_console_dark.png`,
  },
};

// Allow theme: protocol through react-markdown's URL sanitizer
function urlTransform(url: string): string {
  if (url.startsWith("theme:") || url.startsWith("tab:")) return url;
  // Default behavior: allow http, https, mailto
  const protocols = ["http", "https", "mailto"];
  const colon = url.indexOf(":");
  if (colon === -1 || colon > 10) return url;
  const protocol = url.slice(0, colon).toLowerCase();
  return protocols.includes(protocol) ? url : "";
}

export function DocsPage({ onNavigateToTab }: { onNavigateToTab?: (tabId: string) => void } = {}) {
  const [activeSectionId, setActiveSectionId] = useState(DOC_SECTIONS[0].id);
  const activeSection = DOC_SECTIONS.find((s) => s.id === activeSectionId)!;
  const activeIndex = DOC_SECTIONS.findIndex((s) => s.id === activeSectionId);
  const prevSection = activeIndex > 0 ? DOC_SECTIONS[activeIndex - 1] : null;
  const nextSection = activeIndex < DOC_SECTIONS.length - 1 ? DOC_SECTIONS[activeIndex + 1] : null;
  const theme = useAppStore((s) => s.theme);

  return (
    <div className="min-h-[calc(100vh-200px)]">
      {/* Mobile: horizontal scrollable tabs */}
      <nav className="sm:hidden overflow-x-auto scrollbar-hide border-b border-border mb-4 -mx-4 px-4">
        <div className="flex gap-1 pb-2">
          {DOC_SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSectionId(section.id)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                activeSectionId === section.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {section.title}
            </button>
          ))}
        </div>
      </nav>

      <div className="flex gap-0">
        {/* Desktop sidebar */}
        <nav className="hidden sm:block w-56 shrink-0 border-r border-border pr-4 pt-2">
          <ul className="space-y-1">
            {DOC_SECTIONS.map((section) => (
              <li key={section.id}>
                <button
                  onClick={() => setActiveSectionId(section.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                    activeSectionId === section.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  )}
                >
                  {section.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <article className="flex-1 sm:pl-8 pr-0 sm:pr-4 pt-0 sm:pt-2 min-w-0">
        {activeSectionId !== "feedback" && <div className="prose-docs">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={urlTransform}
            components={{
              h1: ({ children }) => (
                <h1 className="text-2xl font-bold text-foreground mb-6 pb-3 border-b border-border">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-lg font-semibold text-foreground mt-8 mb-3">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-base font-semibold text-foreground mt-6 mb-2">
                  {children}
                </h3>
              ),
              h4: ({ children }) => (
                <h4 className="text-sm font-semibold text-foreground mt-5 mb-2">
                  {children}
                </h4>
              ),
              p: ({ children }) => (
                <p className="text-sm text-foreground/85 leading-relaxed mb-4">
                  {children}
                </p>
              ),
              ul: ({ children }) => (
                <ul className="text-sm text-foreground/85 space-y-1.5 mb-4 ml-4 list-disc">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="text-sm text-foreground/85 space-y-1.5 mb-4 ml-4 list-decimal">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="leading-relaxed">{children}</li>
              ),
              img: ({ src, alt }) => {
                if (src?.startsWith("theme:")) {
                  const key = src.replace("theme:", "");
                  const images = THEME_IMAGES[key];
                  if (images) {
                    const imgSrc = theme === "dark" ? images.dark : images.light;
                    return (
                      <span className="block my-6 max-w-[85%]">
                        <img
                          src={imgSrc}
                          alt={alt || key}
                          className="rounded-lg border-2 border-border/60 shadow-md opacity-90"
                        />
                        {alt && <span className="block text-[11px] text-muted-foreground/60 mt-1.5 italic">{alt}</span>}
                      </span>
                    );
                  }
                }
                return (
                  <span className="block my-4 max-w-[85%]">
                    <img src={src} alt={alt} className="rounded-lg border-2 border-border/60 shadow-md opacity-90" />
                  </span>
                );
              },
              code: ({ className, children, ...props }) => {
                const isInline = !className;
                if (isInline) {
                  return (
                    <code className="px-1.5 py-0.5 rounded bg-secondary text-[13px] font-mono text-primary">
                      {children}
                    </code>
                  );
                }
                return (
                  <code className={cn("text-[13px]", className)} {...props}>
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                <pre className="bg-secondary/80 border border-border rounded-lg p-4 mb-4 overflow-x-auto text-[13px] leading-relaxed">
                  {children}
                </pre>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-secondary/50">{children}</thead>
              ),
              th: ({ children }) => (
                <th className="text-left px-3 py-2 font-medium text-foreground border-b border-border">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-3 py-2 text-foreground/85 border-b border-border/50">
                  {children}
                </td>
              ),
              hr: () => <hr className="border-border my-8" />,
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground">
                  {children}
                </strong>
              ),
              a: ({ href, children }) => {
                // Internal doc links: "query-console.mdx" → navigate to section "query-console"
                if (href?.endsWith(".mdx")) {
                  const sectionId = href.replace(/\.mdx$/, "");
                  return (
                    <a
                      href="#"
                      className="text-primary hover:underline cursor-pointer"
                      onClick={(e) => { e.preventDefault(); setActiveSectionId(sectionId); }}
                    >
                      {children}
                    </a>
                  );
                }
                // Tab links: "tab:query" → navigate to dashboard tab
                if (href?.startsWith("tab:")) {
                  const tabId = href.replace("tab:", "");
                  return (
                    <a
                      href="#"
                      className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer font-medium"
                      onClick={(e) => { e.preventDefault(); onNavigateToTab?.(tabId); }}
                    >
                      {children} →
                    </a>
                  );
                }
                return (
                  <a
                    href={href}
                    className="text-primary hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                );
              },
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-primary/40 pl-4 my-4 text-sm text-muted-foreground italic">
                  {children}
                </blockquote>
              ),
            }}
          >
            {activeSectionId === "architecture"
              ? activeSection.content.split(/(?=## How It Works)/)[0]
              : activeSection.content}
          </ReactMarkdown>
        </div>}

        {activeSectionId === "feedback" && (
          <FeedbackSection />
        )}

        {activeSectionId === "architecture" && (
          <>
            <div className="my-8">
              <ArchitectureFlow />
            </div>
            {activeSection.content.split(/(?=## How It Works)/).length > 1 && (
              <div className="prose-docs">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  urlTransform={urlTransform}
                  components={{
                    h2: ({ children }) => (
                      <h2 className="text-lg font-semibold text-foreground mt-8 mb-3">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-base font-semibold text-foreground mt-6 mb-2">{children}</h3>
                    ),
                    h4: ({ children }) => (
                      <h4 className="text-sm font-semibold text-foreground mt-5 mb-2">{children}</h4>
                    ),
                    p: ({ children }) => (
                      <p className="text-sm text-foreground/85 leading-relaxed mb-4">{children}</p>
                    ),
                    ul: ({ children }) => (
                      <ul className="text-sm text-foreground/85 space-y-1.5 mb-4 ml-4 list-disc">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="text-sm text-foreground/85 space-y-1.5 mb-4 ml-4 list-decimal">{children}</ol>
                    ),
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    code: ({ className, children, ...props }) => {
                      const isInline = !className;
                      if (isInline) {
                        return (
                          <code className="px-1.5 py-0.5 rounded bg-secondary text-[13px] font-mono text-primary">{children}</code>
                        );
                      }
                      return <code className={cn("text-[13px]", className)} {...props}>{children}</code>;
                    },
                    pre: ({ children }) => (
                      <pre className="bg-secondary/80 border border-border rounded-lg p-4 mb-4 overflow-x-auto text-[13px] leading-relaxed">{children}</pre>
                    ),
                    table: ({ children }) => (
                      <div className="overflow-x-auto mb-4">
                        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">{children}</table>
                      </div>
                    ),
                    thead: ({ children }) => <thead className="bg-secondary/50">{children}</thead>,
                    th: ({ children }) => (
                      <th className="text-left px-3 py-2 font-medium text-foreground border-b border-border">{children}</th>
                    ),
                    td: ({ children }) => (
                      <td className="px-3 py-2 text-foreground/85 border-b border-border/50">{children}</td>
                    ),
                    hr: () => <hr className="border-border my-8" />,
                    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                    a: ({ href, children }) => {
                      if (href?.endsWith(".mdx")) {
                        const sectionId = href.replace(/\.mdx$/, "");
                        return (
                          <a href="#" className="text-primary hover:underline cursor-pointer"
                            onClick={(e) => { e.preventDefault(); setActiveSectionId(sectionId); }}>{children}</a>
                        );
                      }
                      if (href?.startsWith("tab:")) {
                        const tabId = href.replace("tab:", "");
                        return (
                          <a href="#" className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer font-medium"
                            onClick={(e) => { e.preventDefault(); onNavigateToTab?.(tabId); }}>{children} →</a>
                        );
                      }
                      return <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>;
                    },
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-2 border-primary/40 pl-4 my-4 text-sm text-muted-foreground italic">{children}</blockquote>
                    ),
                  }}
                >
                  {activeSection.content.split(/(?=## How It Works)/)[1]}
                </ReactMarkdown>
              </div>
            )}
          </>
        )}

        {/* Prev / Next navigation */}
        <div className="flex items-center justify-between mt-12 pt-6 border-t border-border">
          {prevSection ? (
            <button
              onClick={() => setActiveSectionId(prevSection.id)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              <ChevronLeft size={14} />
              {prevSection.title}
            </button>
          ) : <span />}
          {nextSection ? (
            <button
              onClick={() => setActiveSectionId(nextSection.id)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              {nextSection.title}
              <ChevronRight size={14} />
            </button>
          ) : <span />}
        </div>
      </article>
      </div>
    </div>
  );
}
