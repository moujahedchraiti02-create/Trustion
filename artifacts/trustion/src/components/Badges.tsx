import { AlertSeverity, ChainStatusIntegrityStatus, LedgerEntrySignerMode, LedgerEntryTemporalTrust, VesselStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, ShieldAlert, Cpu, FileSignature, HelpCircle, Activity } from "lucide-react";

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const styles = {
    WATCH: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    LEGAL_WARNING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    THRESHOLD_EXCEEDED: "bg-destructive/10 text-destructive border-destructive/20"
  };
  
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", styles[severity])}>
      {severity.replace("_", " ")}
    </span>
  );
}

export function TrustBadge({ trust }: { trust: LedgerEntryTemporalTrust }) {
  const styles = {
    TRUSTED_GNSS: "text-green-400 bg-green-500/10 border-green-500/20",
    BACKFILL: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    DRIFT_WARNING: "text-destructive bg-destructive/10 border-destructive/20"
  };

  const icons = {
    TRUSTED_GNSS: <CheckCircle2 className="w-3 h-3 mr-1" />,
    BACKFILL: <Activity className="w-3 h-3 mr-1" />,
    DRIFT_WARNING: <AlertTriangle className="w-3 h-3 mr-1" />
  };

  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono", styles[trust])}>
      {icons[trust]}
      {trust}
    </span>
  );
}

export function SignerBadge({ mode }: { mode: LedgerEntrySignerMode }) {
  const styles = {
    TPM2: "text-primary bg-primary/10 border-primary/20",
    SOFTWARE_ED25519: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    UNSIGNED: "text-muted-foreground bg-muted border-border"
  };

  const icons = {
    TPM2: <Cpu className="w-3 h-3 mr-1" />,
    SOFTWARE_ED25519: <FileSignature className="w-3 h-3 mr-1" />,
    UNSIGNED: <HelpCircle className="w-3 h-3 mr-1" />
  };

  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono", styles[mode])}>
      {icons[mode]}
      {mode}
    </span>
  );
}

export function IntegrityBadge({ status }: { status: ChainStatusIntegrityStatus }) {
  const styles = {
    INTACT: "text-green-400 bg-green-500/10 border-green-500/20",
    BROKEN: "text-destructive bg-destructive/10 border-destructive/20",
    UNKNOWN: "text-muted-foreground bg-muted border-border"
  };

  const icons = {
    INTACT: <CheckCircle2 className="w-3 h-3 mr-1" />,
    BROKEN: <ShieldAlert className="w-3 h-3 mr-1" />,
    UNKNOWN: <HelpCircle className="w-3 h-3 mr-1" />
  };

  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono", styles[status])}>
      {icons[status]}
      {status}
    </span>
  );
}

export function VesselStatusBadge({ status }: { status: VesselStatus }) {
  const styles = {
    ACTIVE: "text-green-400 bg-green-500/10 border-green-500/20",
    INACTIVE: "text-muted-foreground bg-muted border-border",
    DRYDOCK: "text-amber-400 bg-amber-500/10 border-amber-500/20"
  };
  
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border", styles[status])}>
      {status}
    </span>
  );
}
