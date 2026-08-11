import { useQuery } from "@tanstack/react-query";
import { Key, ChevronDown, ChevronUp, ShieldAlert, ShieldCheck, ShieldOff, Clock, User } from "lucide-react";
import { useState } from "react";
import { format, formatDistanceStrict } from "date-fns";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type KeyStatus = "ACTIVE" | "RETIRED" | "REVOKED";
type KeyEventType = "KEY_ACTIVATED" | "KEY_RETIRED" | "KEY_REVOKED";

interface KeyRegistryEntry {
  keyId: string;
  publicKey: string;
  fingerprint: string;
  algorithm: string;
  signingMode: string;
  status: KeyStatus;
  activatedAt: string;
  retiredAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
}

interface KeyRegistryResponse {
  activeKeyId: string | null;
  totalKeys: number;
  entries: KeyRegistryEntry[];
}

interface KeyEvent {
  id: number;
  keyId: string;
  eventType: KeyEventType;
  effectiveAt: string;
  actor: string;
  reason: string | null;
  createdAt: string;
}

interface KeyEventsResponse {
  totalEvents: number;
  events: KeyEvent[];
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchKeyRegistry(): Promise<KeyRegistryResponse> {
  const res = await fetch("/api/key-registry");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchKeyEvents(keyId: string): Promise<KeyEventsResponse> {
  const res = await fetch(`/api/key-registry/events?keyId=${encodeURIComponent(keyId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Badges ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: KeyStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold border",
        status === "ACTIVE"  && "bg-green-500/10 text-green-500 border-green-500/20",
        status === "RETIRED" && "bg-amber-500/10 text-amber-500 border-amber-500/20",
        status === "REVOKED" && "bg-destructive/10 text-destructive border-destructive/20",
      )}
    >
      {status === "ACTIVE"  && <ShieldCheck className="w-3 h-3" />}
      {status === "RETIRED" && <ShieldOff   className="w-3 h-3" />}
      {status === "REVOKED" && <ShieldAlert className="w-3 h-3" />}
      {status}
    </span>
  );
}

function EventTypeBadge({ type }: { type: KeyEventType }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border",
        type === "KEY_ACTIVATED" && "bg-green-500/10 text-green-500 border-green-500/20",
        type === "KEY_RETIRED"   && "bg-amber-500/10 text-amber-500 border-amber-500/20",
        type === "KEY_REVOKED"   && "bg-destructive/10 text-destructive border-destructive/20",
      )}
    >
      {type}
    </span>
  );
}

// ─── Event Timeline ───────────────────────────────────────────────────────────

function KeyEventTimeline({ keyId }: { keyId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["key-events", keyId],
    queryFn: () => fetchKeyEvents(keyId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="py-4 text-center text-xs font-mono text-muted-foreground animate-pulse">
        LOADING_EVENTS...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="py-4 text-center text-xs font-mono text-destructive">
        FAILED_TO_LOAD_EVENTS
      </div>
    );
  }

  if (data.events.length === 0) {
    return (
      <div className="py-4 text-center text-xs font-mono text-muted-foreground">
        NO_EVENTS_RECORDED
      </div>
    );
  }

  // Events come newest-first from API; reverse for chronological display
  const chronological = [...data.events].reverse();

  return (
    <div className="relative pl-6">
      {/* Vertical guide line */}
      <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />

      <div className="space-y-3">
        {chronological.map((event, idx) => (
          <div key={event.id} className="relative flex flex-col gap-0.5">
            {/* Timeline dot */}
            <div
              className={cn(
                "absolute -left-4 top-1.5 w-2 h-2 rounded-full border",
                event.eventType === "KEY_ACTIVATED" && "bg-green-500 border-green-500",
                event.eventType === "KEY_RETIRED"   && "bg-amber-500 border-amber-500",
                event.eventType === "KEY_REVOKED"   && "bg-destructive border-destructive",
              )}
            />

            <div className="flex flex-wrap items-center gap-2">
              <EventTypeBadge type={event.eventType} />
              <span className="text-xs font-mono text-muted-foreground">
                {format(new Date(event.effectiveAt), "yyyy-MM-dd HH:mm:ss 'UTC'")}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-0.5">
              <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                <User className="w-3 h-3" /> {event.actor}
              </span>
              {event.reason && (
                <span className="text-xs text-foreground/70 italic">"{event.reason}"</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Key Card ─────────────────────────────────────────────────────────────────

function KeyCard({ entry, isActive }: { entry: KeyRegistryEntry; isActive: boolean }) {
  const [open, setOpen] = useState(entry.status === "ACTIVE");

  const activatedAt  = new Date(entry.activatedAt);
  const retiredAt    = entry.retiredAt  ? new Date(entry.retiredAt)  : null;
  const revokedAt    = entry.revokedAt  ? new Date(entry.revokedAt)  : null;

  // "Signed before revocation" window: gap between activation and revocation
  const activeWindow =
    revokedAt
      ? formatDistanceStrict(activatedAt, revokedAt, { addSuffix: false })
      : retiredAt
      ? formatDistanceStrict(activatedAt, retiredAt, { addSuffix: false })
      : null;

  return (
    <div
      className={cn(
        "bg-card border rounded-sm overflow-hidden transition-colors",
        isActive ? "border-primary/40" : "border-border",
      )}
    >
      {/* Card header — always visible */}
      <button
        className="w-full text-left p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-accent/30 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={entry.status} />
            {isActive && (
              <span className="text-xs font-mono text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded">
                CURRENT_SIGNER
              </span>
            )}
          </div>

          <div className="font-mono text-sm font-bold tracking-tight break-all">
            {entry.fingerprint}
            <span className="text-muted-foreground font-normal">…</span>
          </div>

          <div className="flex flex-wrap gap-4 text-xs font-mono text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Activated {format(activatedAt, "yyyy-MM-dd HH:mm")}
            </span>
            {retiredAt && (
              <span>Retired {format(retiredAt, "yyyy-MM-dd HH:mm")}</span>
            )}
            {revokedAt && (
              <span className="text-destructive">
                Revoked {format(revokedAt, "yyyy-MM-dd HH:mm")}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {open ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-border">
          {/* Key metadata */}
          <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 text-xs font-mono border-b border-border bg-background/40">
            <div>
              <div className="text-muted-foreground mb-0.5">ALGORITHM</div>
              <div>{entry.algorithm} / {entry.signingMode}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-0.5">KEY_ID (SHA-256)</div>
              <div className="break-all text-[10px] text-foreground/70">{entry.keyId}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-0.5">PUBLIC_KEY</div>
              <div className="break-all text-[10px] text-foreground/70">{entry.publicKey}</div>
            </div>

            {activeWindow && (
              <div>
                <div className="text-muted-foreground mb-0.5">
                  {entry.status === "REVOKED" ? "VALID_SIGNING_WINDOW" : "ACTIVE_DURATION"}
                </div>
                <div className={entry.status === "REVOKED" ? "text-amber-500" : ""}>{activeWindow}</div>
              </div>
            )}
          </div>

          {/* Revocation callout */}
          {entry.status === "REVOKED" && (
            <div className="px-5 py-4 border-b border-border bg-destructive/5">
              <div className="flex flex-col gap-2">
                <div className="text-xs font-mono font-bold text-destructive flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" /> KEY_REVOKED
                </div>
                {entry.revocationReason && (
                  <p className="text-sm text-foreground/80">
                    <span className="font-mono text-muted-foreground text-xs">Reason: </span>
                    {entry.revocationReason}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Signatures bearing this key ID that carry a timestamp{" "}
                  <span className="text-foreground">before {revokedAt ? format(revokedAt, "yyyy-MM-dd HH:mm:ss 'UTC'") : "—"}</span>{" "}
                  are historically legitimate. Signatures on or after the revocation timestamp are suspicious.
                </p>
              </div>
            </div>
          )}

          {/* Event timeline */}
          <div className="px-5 py-4">
            <div className="text-xs font-mono text-muted-foreground uppercase mb-4">
              Lifecycle Events
            </div>
            <KeyEventTimeline keyId={entry.keyId} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SigningKeyHistory() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["key-registry"],
    queryFn: fetchKeyRegistry,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Header */}
      <div className="flex-none p-6 border-b border-border bg-card">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Key className="w-6 h-6 text-primary" />
            Signing Key History
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Append-only chain-of-custody record for every signing identity. Used by auditors to
            establish whether evidence signatures predate any key revocation.
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* Summary strip */}
          {data && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Total Keys",   value: data.totalKeys },
                { label: "Active",       value: data.entries.filter(e => e.status === "ACTIVE").length },
                { label: "Retired",      value: data.entries.filter(e => e.status === "RETIRED").length },
                { label: "Revoked",      value: data.entries.filter(e => e.status === "REVOKED").length },
              ].map(({ label, value }) => (
                <div key={label} className="bg-card border border-border rounded-sm p-4">
                  <div className="text-xs font-mono text-muted-foreground uppercase mb-1">{label}</div>
                  <div className="text-2xl font-mono font-bold text-primary">{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Key list */}
          {isLoading && (
            <div className="h-64 flex items-center justify-center border border-border rounded-sm bg-card text-muted-foreground font-mono animate-pulse">
              LOADING_KEY_REGISTRY...
            </div>
          )}

          {isError && (
            <div className="h-40 flex items-center justify-center border border-destructive/20 rounded-sm bg-destructive/5 text-destructive font-mono text-sm">
              REGISTRY_FETCH_FAILED — check API server
            </div>
          )}

          {data && data.entries.length === 0 && (
            <div className="h-40 flex items-center justify-center border border-dashed border-border rounded-sm bg-card text-muted-foreground font-mono text-sm">
              NO_KEYS_REGISTERED
            </div>
          )}

          {data && data.entries.map((entry) => (
            <KeyCard
              key={entry.keyId}
              entry={entry}
              isActive={entry.keyId === data.activeKeyId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
