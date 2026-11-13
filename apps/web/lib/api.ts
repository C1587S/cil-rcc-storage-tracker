import type {
  Snapshot,
  BrowseResponse,
  ContentsResponse,
  SearchResponse,
  QueryResponse,
  NLToSQLResponse,
  ComputingReport,
  ProjectionReport,
  FeedbackEntry,
} from "./types";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BASE_PATH || "";

async function apiRequest<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API error: ${res.status} ${errorText}`);
  }

  return res.json();
}

export async function getSnapshots(): Promise<Snapshot[]> {
  return apiRequest<Snapshot[]>("/api/snapshots");
}

export async function getBrowse(params: {
  snapshot_date: string;
  parent_path: string;
  limit?: number;
}): Promise<BrowseResponse> {
  const searchParams = new URLSearchParams({
    snapshot_date: params.snapshot_date,
    parent_path: params.parent_path,
    limit: String(params.limit || 1000),
  });

  return apiRequest<BrowseResponse>(`/api/browse?${searchParams}`);
}

export async function getContents(params: {
  snapshot_date: string;
  parent_path: string;
  limit?: number;
  offset?: number;
  sort?: string;
  filter_type?: string;
}): Promise<ContentsResponse> {
  const searchParams = new URLSearchParams({
    snapshot_date: params.snapshot_date,
    parent_path: params.parent_path,
  });

  if (params.limit !== undefined) {
    searchParams.set("limit", String(params.limit));
  }
  if (params.offset !== undefined) {
    searchParams.set("offset", String(params.offset));
  }
  if (params.sort) {
    searchParams.set("sort", params.sort);
  }
  if (params.filter_type) {
    searchParams.set("filter_type", params.filter_type);
  }

  return apiRequest<ContentsResponse>(`/api/contents?${searchParams}`);
}

export async function search(params: {
  snapshot_date: string;
  q: string;
  mode?: "exact" | "contains" | "prefix" | "suffix";
  scope_path?: string;
  include_files?: boolean;
  include_dirs?: boolean;
  limit?: number;
}): Promise<SearchResponse> {
  const searchParams = new URLSearchParams({
    snapshot_date: params.snapshot_date,
    q: params.q,
  });

  if (params.mode) {
    searchParams.set("mode", params.mode);
  }
  if (params.scope_path) {
    searchParams.set("scope_path", params.scope_path);
  }
  if (params.include_files !== undefined) {
    searchParams.set("include_files", String(params.include_files));
  }
  if (params.include_dirs !== undefined) {
    searchParams.set("include_dirs", String(params.include_dirs));
  }
  if (params.limit !== undefined) {
    searchParams.set("limit", String(params.limit));
  }

  return apiRequest<SearchResponse>(`/api/search?${searchParams}`);
}

export async function executeQuery(params: {
  snapshot_date: string;
  sql: string;
  limit?: number;
}): Promise<QueryResponse> {
  return apiRequest<QueryResponse>("/api/query", {
    method: "POST",
    body: JSON.stringify(params),
  });
}


export async function generateSQLFromNL(params: {
  snapshot_date: string;
  question: string;
}): Promise<NLToSQLResponse> {
  return apiRequest<NLToSQLResponse>("/api/nl-to-sql", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function fixSQLWithAI(params: {
  snapshot_date: string;
  sql: string;
  error: string;
}): Promise<NLToSQLResponse> {
  return apiRequest<NLToSQLResponse>("/api/nl-to-sql/fix", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function validateUser(username: string): Promise<{ valid: boolean; username: string }> {
  return apiRequest<{ valid: boolean; username: string }>("/api/auth/validate", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

export async function getComputingReport(): Promise<ComputingReport> {
  return apiRequest<ComputingReport>("/api/computing/latest");
}

export async function getProjectionReport(): Promise<ProjectionReport> {
  return apiRequest<ProjectionReport>("/api/projections/latest");
}

export async function getFeedback(): Promise<FeedbackEntry[]> {
  return apiRequest<FeedbackEntry[]>("/api/feedback");
}

// The server returns a one-time delete token per posted comment; only this
// browser keeps it. The displayed username cannot authorize a delete.
const FEEDBACK_TOKENS = "feedback-delete-tokens";

function feedbackTokens(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_TOKENS) || "{}"); } catch { return {}; }
}

export async function postFeedback(params: {
  username: string;
  message: string;
  parent_id?: string | null;
}): Promise<FeedbackEntry> {
  const posted = await apiRequest<FeedbackEntry & { delete_token?: string }>("/api/feedback", {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (posted.delete_token) {
    try {
      localStorage.setItem(FEEDBACK_TOKENS,
        JSON.stringify({ ...feedbackTokens(), [posted.id]: posted.delete_token }));
    } catch { /* storage full/blocked: the comment just can't be self-deleted */ }
  }
  const { delete_token: _omit, ...entry } = posted;
  return entry;
}

/** `username` is kept for call-site compatibility; authorization is the token. */
export async function deleteFeedback(feedbackId: string, _username?: string): Promise<void> {
  const token = feedbackTokens()[feedbackId];
  const url = `${API_BASE_URL}/api/feedback/${encodeURIComponent(feedbackId)}`;
  const res = await fetch(url, { method: "DELETE", headers: token ? { "X-Delete-Token": token } : {} });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API error: ${res.status} ${errorText}`);
  }
  const { [feedbackId]: _gone, ...rest } = feedbackTokens();
  try { localStorage.setItem(FEEDBACK_TOKENS, JSON.stringify(rest)); } catch { /* ignore */ }
}
