"use client";

/** Operator unlock for housekeeping changes.
 *
 *  Everyone can browse the dashboard with just a username; that username is
 *  a label and grants nothing. Changing housekeeping state needs the
 *  server-side operator key. The key is checked by the server
 *  (/api/housekeeping/operator) before it is kept in this browser.
 */
import { useEffect, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { hkApi, operatorKey, setOperatorKey, OPERATOR_KEY_EVENT, toast } from "@/lib/hk";

type Status = { configured: boolean; unlocked: boolean } | null;

export function OperatorKeyControl() {
  const [status, setStatus] = useState<Status>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try { setStatus(await hkApi("/operator")); } catch { setStatus(null); }
  };

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(OPERATOR_KEY_EVENT, onChange);
    return () => window.removeEventListener(OPERATOR_KEY_EVENT, onChange);
  }, []);

  const unlock = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true);
    const previous = operatorKey();
    setOperatorKey(key);
    try {
      const s: Status = await hkApi("/operator");
      if (s?.unlocked) {
        setEditing(false);
        setDraft("");
        toast("Changes unlocked for this browser.", "success");
      } else {
        setOperatorKey(previous);
        toast(s?.configured ? "That key is not valid." : "Changes are disabled on the server.", "error");
      }
    } catch (e: any) {
      setOperatorKey(previous);
      toast(e.message || "Could not verify the key.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (status && !status.configured) {
    return (
      <span className="text-[11px] text-muted-foreground flex items-center gap-1"
            title="The server has no operator key configured, so housekeeping is read-only for everyone.">
        <Lock className="h-3.5 w-3.5" /> Read-only
      </span>
    );
  }

  if (status?.unlocked) {
    return (
      <button className="text-[11px] flex items-center gap-1 text-emerald-600 hover:underline"
              title="Changes are unlocked in this browser. Click to lock again."
              onClick={() => setOperatorKey(null)}>
        <LockOpen className="h-3.5 w-3.5" /> Operator mode · lock
      </button>
    );
  }

  if (editing) {
    return (
      <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); unlock(); }}>
        <input type="password" autoComplete="current-password" autoFocus
               className="h-7 w-48 rounded border border-border/60 bg-background px-2 text-[11px]"
               placeholder="Operator key" value={draft} onChange={e => setDraft(e.target.value)} />
        <button type="submit" disabled={busy || !draft.trim()}
                className={cn("h-7 px-2 rounded border text-[11px]",
                  busy ? "opacity-50" : "border-primary/60 text-primary hover:bg-primary/10")}>
          {busy ? "Checking…" : "Unlock"}
        </button>
        <button type="button" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => { setEditing(false); setDraft(""); }}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <button className="text-[11px] flex items-center gap-1 text-muted-foreground hover:text-foreground"
            title="Viewing is open to everyone. Making changes needs the operator key."
            onClick={() => setEditing(true)}>
      <Lock className="h-3.5 w-3.5" /> Read-only · unlock changes
    </button>
  );
}
