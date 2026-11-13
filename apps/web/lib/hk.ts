// Shared housekeeping helpers usable from any view (tree, treemap, recon).

import { API_BASE_URL } from "@/lib/api";

/** THE identity source for every housekeeping call. Read at call time from
 *  the login gate's storage — never threaded through props/state, so a
 *  component mounted before store hydration can't silently drop it. */
export function currentIdentity(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem("cil-user");
}

/** Operator key: the server-side secret that unlocks housekeeping changes.
 *  The username above is only a label; it never grants anything. */
const OPERATOR_KEY_STORAGE = "hk-operator-key";
export const OPERATOR_KEY_EVENT = "hk-operator-key-changed";

export function operatorKey(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(OPERATOR_KEY_STORAGE);
}

export function setOperatorKey(key: string | null) {
  if (typeof localStorage === "undefined") return;
  if (key) localStorage.setItem(OPERATOR_KEY_STORAGE, key);
  else localStorage.removeItem(OPERATOR_KEY_STORAGE);
  window.dispatchEvent(new Event(OPERATOR_KEY_EVENT));
}

/** Headers for every housekeeping call: who (a label) + operator key (if set). */
export function hkHeaders(user?: string | null): Record<string, string> {
  const uid = user ?? currentIdentity();
  const key = operatorKey();
  return {
    ...(uid ? { "X-User": uid } : {}),
    ...(key ? { "X-Operator-Key": key } : {}),
  };
}

/** The one fetch wrapper for /api/housekeeping/*. Identity is resolved at
 *  call time (per-call `user` only for tests); errors surface the server's
 *  detail as the thrown message. */
export async function hkApi(path: string, opts: RequestInit = {}, user?: string | null) {
  const res = await fetch(`${API_BASE_URL}/api/housekeeping${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
      ...hkHeaders(user),
    },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`housekeeping API ${res.status} ${path}:`, d?.detail || d);
    throw new Error(d?.detail || `Request failed (${res.status})`);
  }
  return d;
}

/** POSIX single-quote a string for a pasted shell command. File names are
 *  chosen by anyone with write access on the cluster, so a `'` in a path
 *  must not be able to end the quoting. */
export function shQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Reverse of a quarantine rename. Recreates the parent directory (the
 *  executor removes emptied directories) and never overwrites a file that
 *  has since appeared at the original path (mv -n). */
export function restoreCommand(quarantinePath: string, originalPath: string): string {
  const cut = originalPath.lastIndexOf("/");
  const parent = cut > 0 ? originalPath.slice(0, cut) : "/";
  return `mkdir -p -- ${shQuote(parent)} && mv -n -- ${shQuote(quarantinePath)} ${shQuote(originalPath)}`;
}

/** Recon sub-API (candidate discovery, lists, dismissals). */
export const reconApi = (path: string, opts: RequestInit = {}, user?: string | null) =>
  hkApi(`/recon${path}`, opts, user);

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
    return ("No list is active yet. Lists collect paths you want to act on: "
      + "open the Housekeeping tab, pick or create one under Custom lists, then retry.");
  }
  const res = await fetch(`${API_BASE_URL}/api/housekeeping/recon/lists/${list.id}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...hkHeaders() },
    body: JSON.stringify({ paths, source }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return `Failed: ${d?.detail || res.status}`;
  const rej = d.rejected?.length
    ? ` — ${d.rejected.length} rejected (${d.rejected[0].reason})`
    : "";
  return `Added ${d.added.length} item(s) to "${list.name}"${rej}`;
}

// ---- Toasts: the tool never uses native alert()/confirm()/prompt(). ----
// Non-blocking, styled, auto-dismissing; errors persist a little longer.
export function toast(message: string, kind: "info" | "error" | "success" = "info") {
  if (typeof document === "undefined") return;
  let host = document.getElementById("hk-toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "hk-toasts";
    host.style.cssText =
      "position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:420px;";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.style.cssText =
    "padding:10px 14px;border-radius:8px;font-size:12px;line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,.25);" +
    "font-family:ui-monospace,monospace;white-space:pre-wrap;" +
    (kind === "error"
      ? "background:#7f1d1d;color:#fecaca;border:1px solid #b91c1c;"
      : kind === "success"
        ? "background:#14532d;color:#bbf7d0;border:1px solid #16a34a;"
        : "background:#1f2937;color:#e5e7eb;border:1px solid #374151;");
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .4s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
  }, kind === "error" ? 9000 : 4500);
}
