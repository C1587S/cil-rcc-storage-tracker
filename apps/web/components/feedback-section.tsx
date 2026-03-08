"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { getFeedback, postFeedback, deleteFeedback } from "@/lib/api";
import { cn, getUserColor } from "@/lib/utils";
import { MessageSquare, Send, Trash2, Loader2, Reply, ChevronRight, ChevronDown } from "lucide-react";
import type { FeedbackEntry } from "@/lib/types";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function CommentForm({
  onSubmit,
  placeholder,
  submitting,
  autoFocus,
  onCancel,
}: {
  onSubmit: (message: string) => void;
  placeholder: string;
  submitting: boolean;
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const [message, setMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setMessage("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={placeholder}
        maxLength={2000}
        rows={2}
        autoFocus={autoFocus}
        className={cn(
          "flex-1 px-3 py-2 rounded-lg border text-sm resize-none",
          "bg-secondary/30 text-foreground placeholder:text-muted-foreground/50",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
          "border-border transition-colors"
        )}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
          if (e.key === "Escape" && onCancel) {
            onCancel();
          }
        }}
      />
      <div className="flex flex-col gap-1 self-end">
        <button
          type="submit"
          disabled={submitting || !message.trim()}
          className={cn(
            "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Comment({
  entry,
  currentUser,
  onReply,
  onDelete,
  replyingTo,
  setReplyingTo,
  submitting,
  depth,
  expandedThreads,
  onToggleThread,
}: {
  entry: FeedbackEntry;
  currentUser: string | null;
  onReply: (parentId: string, message: string) => void;
  onDelete: (id: string) => void;
  replyingTo: string | null;
  setReplyingTo: (id: string | null) => void;
  submitting: boolean;
  depth: number;
  expandedThreads?: Set<string>;
  onToggleThread?: (id: string) => void;
}) {
  const isReplying = replyingTo === entry.id;

  return (
    <div className={cn(depth > 0 && "ml-6 pl-4 border-l-2 border-border/40")}>
      <div className="group rounded-lg border border-border/50 bg-secondary/20 px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div
              style={{ width: 8, height: 8, borderRadius: 2, background: getUserColor(entry.username), flexShrink: 0 }}
            />
            <span className="text-sm font-medium text-foreground font-mono">{entry.username}</span>
            <span className="text-xs text-muted-foreground/50">{formatDate(entry.created_at)}</span>
          </div>
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
            {currentUser && (
              <button
                onClick={() => setReplyingTo(isReplying ? null : entry.id)}
                className="text-muted-foreground/40 hover:text-primary transition-colors"
                title="Reply"
              >
                <Reply size={13} />
              </button>
            )}
            {currentUser === entry.username && (
              <button
                onClick={() => onDelete(entry.id)}
                className="text-muted-foreground/40 hover:text-red-500 transition-colors"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{entry.message}</p>
      </div>

      {isReplying && (
        <div className="mt-2 ml-2">
          <CommentForm
            onSubmit={(msg) => {
              onReply(entry.id, msg);
              setReplyingTo(null);
            }}
            placeholder={`Reply to ${entry.username}...`}
            submitting={submitting}
            autoFocus
            onCancel={() => setReplyingTo(null)}
          />
        </div>
      )}

      {entry.replies.length > 0 && depth === 0 && (
        <div className="mt-1.5">
          <button
            onClick={() => onToggleThread?.(entry.id)}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors",
              "text-primary/70 hover:text-primary hover:bg-primary/5"
            )}
          >
            {expandedThreads?.has(entry.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span>{entry.replies.length} {entry.replies.length === 1 ? "reply" : "replies"}</span>
          </button>
          {expandedThreads?.has(entry.id) && (
            <div className="mt-2 space-y-2">
              {entry.replies.map((reply) => (
                <Comment
                  key={reply.id}
                  entry={reply}
                  currentUser={currentUser}
                  onReply={onReply}
                  onDelete={onDelete}
                  replyingTo={replyingTo}
                  setReplyingTo={setReplyingTo}
                  submitting={submitting}
                  depth={1}
                  expandedThreads={expandedThreads}
                  onToggleThread={onToggleThread}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FeedbackSection() {
  const currentUser = useAppStore((s) => s.currentUser);
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  const toggleThread = useCallback((id: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await getFeedback();
      setEntries(data);
      setError("");
    } catch {
      setError("Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (message: string, parentId?: string) => {
    if (!currentUser) return;
    setSubmitting(true);
    setError("");
    try {
      await postFeedback({
        username: currentUser,
        message,
        parent_id: parentId || null,
      });
      if (parentId) {
        setExpandedThreads((prev) => new Set(prev).add(parentId));
      }
      await load();
    } catch {
      setError("Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  };

  const removeEntryById = (entries: FeedbackEntry[], id: string): FeedbackEntry[] =>
    entries
      .filter((e) => e.id !== id)
      .map((e) => ({ ...e, replies: removeEntryById(e.replies, id) }));

  const handleDelete = async (id: string) => {
    if (!currentUser) return;
    if (!window.confirm("Delete this comment?")) return;
    setError("");
    setEntries((prev) => removeEntryById(prev, id));
    try {
      await deleteFeedback(id, currentUser);
      // Small delay before refreshing to let the server settle
      await new Promise((r) => setTimeout(r, 300));
      await load();
    } catch {
      // Wait a moment then retry load before showing error
      await new Promise((r) => setTimeout(r, 500));
      try {
        await load();
      } catch {
        setError("Failed to delete comment");
      }
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground mb-2 pb-3 border-b border-border">Feedback</h1>
      <p className="text-sm text-foreground/85 leading-relaxed mb-6">
        Suggestions, concerns, or ideas to improve the console. All comments are visible to the team.
      </p>

      {/* New comment form */}
      <div className="mb-6">
        <CommentForm
          onSubmit={(msg) => handleSubmit(msg)}
          placeholder="Share a suggestion, concern, or idea..."
          submitting={submitting}
        />
        {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      </div>

      {/* Comments */}
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare size={16} className="text-muted-foreground" />
        <h3 className="text-sm font-medium text-muted-foreground">
          Comments {entries.length > 0 && <span className="text-muted-foreground/50">({entries.length})</span>}
        </h3>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded-lg bg-secondary/30 h-16" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 italic">No comments yet. Be the first to share feedback.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Comment
              key={entry.id}
              entry={entry}
              currentUser={currentUser}
              onReply={(parentId, msg) => handleSubmit(msg, parentId)}
              onDelete={handleDelete}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
              submitting={submitting}
              depth={0}
              expandedThreads={expandedThreads}
              onToggleThread={toggleThread}
            />
          ))}
        </div>
      )}
    </div>
  );
}
