// Shared housekeeping helpers usable from any view (tree, treemap, recon).

import { API_BASE_URL } from "@/lib/api";

export function activeList(): { id: number; name: string } | null {
  try {
    const raw = localStorage.getItem("hk-active-list");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setActiveList(list: { id: number; name: string } | null) {
  if (list) localStorage.setItem("hk-active-list", JSON.stringify(list));
  else localStorage.removeItem("hk-active-list");
}

/** Add paths to the active custom list. Returns a human summary. */
export async function addToActiveList(paths: string[], source: string): Promise<string> {
  const list = activeList();
  if (!list) {
    return "No active list. Open Housekeeping → Custom lists and select one first.";
  }
  const user = localStorage.getItem("cil-user");
  const res = await fetch(`${API_BASE_URL}/api/housekeeping/recon/lists/${list.id}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(user ? { "X-User": user } : {}) },
    body: JSON.stringify({ paths, source }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return `Failed: ${d?.detail || res.status}`;
  const rej = d.rejected?.length
    ? ` — ${d.rejected.length} rejected (${d.rejected[0].reason})`
    : "";
  return `Added ${d.added.length} item(s) to "${list.name}"${rej}`;
}
