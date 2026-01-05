import type {
  Snapshot,
  BrowseResponse,
  ContentsResponse,
  SearchResponse,
  QueryResponse,
} from "./types";

const API_BASE_URL = "";

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


export const foldersApi = {
  async getTree(path: string, snapshot: string) {
    return getContents({
      snapshot_date: snapshot,
      parent_path: path,
      limit: 5000
    })
  }
}