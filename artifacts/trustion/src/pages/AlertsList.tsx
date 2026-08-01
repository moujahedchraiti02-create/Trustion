import { 
  useGetAlerts, getGetAlertsQueryKey,
  useAcknowledgeAlert,
  GetAlertsSeverity
} from "@workspace/api-client-react";
import { SeverityBadge } from "@/components/Badges";
import { BellRing, Filter, CheckCircle } from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

export default function AlertsList() {
  const [severity, setSeverity] = useState<GetAlertsSeverity>(null);
  const [status, setStatus] = useState<"all" | "open" | "ack">("open");
  const queryClient = useQueryClient();

  const ackMutation = useAcknowledgeAlert();

  const { data: alerts, isLoading } = useGetAlerts(
    { 
      severity, 
      acknowledged: status === "all" ? null : status === "ack" 
    },
    { 
      query: { 
        queryKey: getGetAlertsQueryKey({ severity, acknowledged: status === "all" ? null : status === "ack" }) 
      } 
    }
  );

  const handleAcknowledge = (id: number) => {
    ackMutation.mutate(
      { params: { id }, data: { acknowledgedBy: "sys_admin" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAlertsQueryKey() });
        }
      }
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="flex-none p-6 border-b border-border bg-card">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <BellRing className="w-6 h-6 text-primary" />
              Materiality Alerts
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Deviations, threshold breaches, and compliance warnings.</p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono bg-background border border-border px-3 py-1.5 rounded-sm">
              <Filter className="w-4 h-4" /> FILTERS
            </div>

            <Select 
              value={severity || "all"} 
              onValueChange={(v) => setSeverity(v === "all" ? null : v as GetAlertsSeverity)}
            >
              <SelectTrigger className="w-[180px] h-9 rounded-sm bg-background border-border font-mono text-xs">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border rounded-sm">
                <SelectItem value="all" className="font-mono text-xs">ALL_SEVERITIES</SelectItem>
                <SelectItem value="THRESHOLD_EXCEEDED" className="font-mono text-xs">THRESHOLD_EXCEEDED</SelectItem>
                <SelectItem value="LEGAL_WARNING" className="font-mono text-xs">LEGAL_WARNING</SelectItem>
                <SelectItem value="WATCH" className="font-mono text-xs">WATCH</SelectItem>
              </SelectContent>
            </Select>

            <Select 
              value={status} 
              onValueChange={(v: any) => setStatus(v)}
            >
              <SelectTrigger className="w-[150px] h-9 rounded-sm bg-background border-border font-mono text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border rounded-sm">
                <SelectItem value="all" className="font-mono text-xs">ALL_STATUS</SelectItem>
                <SelectItem value="open" className="font-mono text-xs">UNACKNOWLEDGED</SelectItem>
                <SelectItem value="ack" className="font-mono text-xs">ACKNOWLEDGED</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto space-y-4">
          {isLoading ? (
            <div className="text-center text-muted-foreground font-mono animate-pulse py-12">SCANNING_ALERTS...</div>
          ) : alerts?.length === 0 ? (
            <div className="text-center text-muted-foreground font-mono py-12 border border-dashed border-border rounded-sm">NO_ALERTS_MATCH_CRITERIA</div>
          ) : (
            alerts?.map((alert) => (
              <div 
                key={alert.id} 
                className={`bg-card border rounded-sm overflow-hidden flex flex-col md:flex-row transition-colors ${
                  !alert.acknowledged && alert.severity === 'THRESHOLD_EXCEEDED' ? 'border-destructive/50 shadow-[0_0_15px_rgba(255,0,0,0.1)]' : 'border-border'
                }`}
              >
                <div className={`w-1 md:w-2 shrink-0 ${
                  alert.severity === 'THRESHOLD_EXCEEDED' ? 'bg-destructive' : 
                  alert.severity === 'LEGAL_WARNING' ? 'bg-amber-500' : 'bg-blue-500'
                }`} />
                
                <div className="flex-1 p-4 flex flex-col justify-between">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-3">
                      <SeverityBadge severity={alert.severity} />
                      <span className="text-xs text-muted-foreground font-mono">
                        {format(new Date(alert.createdAt), "yyyy-MM-dd HH:mm")}
                      </span>
                    </div>
                    <div className="text-xs font-mono">
                      Vessel: <Link href={`/vessels/${alert.vesselId}`} className="text-primary hover:underline">{alert.vesselName || alert.vesselId}</Link>
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <h3 className="font-bold text-lg">{alert.alertType}</h3>
                    <p className="text-muted-foreground text-sm mt-1">{alert.message}</p>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div className="bg-background border border-border px-3 py-1.5 rounded-sm flex items-center gap-2">
                      <span className="text-muted-foreground">Current:</span>
                      <span className={alert.currentPct > alert.thresholdPct ? "text-destructive" : "text-foreground"}>
                        {alert.currentPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="bg-background border border-border px-3 py-1.5 rounded-sm flex items-center gap-2">
                      <span className="text-muted-foreground">Threshold:</span>
                      <span>{alert.thresholdPct.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>

                <div className="border-t md:border-t-0 md:border-l border-border p-4 bg-secondary/10 flex items-center justify-center min-w-[160px]">
                  {alert.acknowledged ? (
                    <div className="text-center">
                      <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-500/10 text-green-400 mb-2">
                        <CheckCircle className="w-4 h-4" />
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">ACKNOWLEDGED</div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-1 truncate max-w-[120px]">By: {alert.acknowledgedBy}</div>
                    </div>
                  ) : (
                    <button 
                      onClick={() => handleAcknowledge(alert.id)}
                      disabled={ackMutation.isPending}
                      className="w-full h-9 bg-secondary hover:bg-secondary/80 text-secondary-foreground text-sm font-medium font-mono rounded-sm border border-border transition-colors flex items-center justify-center disabled:opacity-50"
                    >
                      {ackMutation.isPending ? "PROCESSING..." : "ACKNOWLEDGE"}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
