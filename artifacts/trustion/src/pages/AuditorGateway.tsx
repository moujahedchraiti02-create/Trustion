import { 
  useGetAuditorEvidence, getGetAuditorEvidenceQueryKey,
  useGetVessels, getGetVesselsQueryKey,
  useSubmitAuditorDecision,
  AuditorDecisionInputDecision
} from "@workspace/api-client-react";
import { ShieldCheck, Anchor, Database, Activity, Check, X, HelpCircle, Lock } from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { IntegrityBadge } from "@/components/Badges";
import { useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";

export default function AuditorGateway() {
  const [vesselId, setVesselId] = useState<number | undefined>();
  const [rationale, setRationale] = useState("");
  const queryClient = useQueryClient();

  const { data: vessels } = useGetVessels({ query: { queryKey: getGetVesselsQueryKey() } });
  
  const { data: packageData, isLoading } = useGetAuditorEvidence(
    vesselId!,
    { query: { enabled: !!vesselId, queryKey: getGetAuditorEvidenceQueryKey(vesselId!) } }
  );

  const decisionMutation = useSubmitAuditorDecision();

  const handleSubmit = (decision: AuditorDecisionInputDecision) => {
    if (!vesselId || !packageData) return;
    
    // Hash is mocked for frontend demo purposes, backend computes real hash
    const fakeHash = `pkg_${Date.now().toString(16)}_${vesselId}`;

    decisionMutation.mutate(
      { 
        data: { 
          vesselId, 
          evidencePackageHash: fakeHash, 
          decision, 
          rationale: rationale || "No rationale provided",
          verifierId: "AUDITOR_001" 
        } 
      },
      {
        onSuccess: () => {
          setRationale("");
          queryClient.invalidateQueries({ queryKey: getGetAuditorEvidenceQueryKey(vesselId) });
        }
      }
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="flex-none p-6 border-b border-border bg-card">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-primary" />
              Auditor Gateway
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Independent verification of evidence packages.</p>
          </div>
          
          <div className="w-full md:w-72">
            <Select 
              value={vesselId?.toString()} 
              onValueChange={(v) => setVesselId(Number(v))}
            >
              <SelectTrigger className="w-full h-10 rounded-sm bg-background border-border font-mono text-sm">
                <SelectValue placeholder="Select Vessel for Audit" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border rounded-sm">
                {vessels?.map(v => (
                  <SelectItem key={v.id} value={v.id.toString()} className="font-mono text-xs">
                    {v.imoNumber} - {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          {!vesselId ? (
            <div className="h-64 flex flex-col items-center justify-center border border-dashed border-border rounded-sm bg-card text-muted-foreground">
              <Lock className="w-12 h-12 mb-4 opacity-20" />
              <div className="font-mono">AWAITING_VESSEL_SELECTION</div>
            </div>
          ) : isLoading ? (
            <div className="h-64 flex items-center justify-center border border-border rounded-sm bg-card text-muted-foreground font-mono animate-pulse">
              COMPILING_EVIDENCE_PACKAGE...
            </div>
          ) : packageData ? (
            <div className="space-y-8">
              {/* Package Header */}
              <div className="bg-card border border-border rounded-sm p-6 flex flex-col md:flex-row justify-between gap-6">
                <div>
                  <div className="text-xs font-mono text-muted-foreground mb-1">Package Generated</div>
                  <div className="font-mono font-bold text-primary">{format(new Date(packageData.generatedAt), "yyyy-MM-dd HH:mm:ss 'UTC'")}</div>
                </div>
                <div>
                  <div className="text-xs font-mono text-muted-foreground mb-1">Ledger Scope</div>
                  <div className="font-mono">{packageData.ledgerEntries.length} entries</div>
                </div>
                <div>
                  <div className="text-xs font-mono text-muted-foreground mb-1">Chain Integrity</div>
                  <div><IntegrityBadge status={packageData.chainStatus.integrityStatus} /></div>
                </div>
              </div>

              {/* Data Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-card border border-border rounded-sm p-5 space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 border-b border-border pb-2">
                    <Activity className="w-4 h-4 text-muted-foreground" /> Emissions Summary
                  </h3>
                  <div className="space-y-3 font-mono text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total CO2e</span>
                      <span className="font-bold text-primary">{packageData.emissionsSummary.totalCo2eKg.toLocaleString()} kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total CO2</span>
                      <span>{packageData.emissionsSummary.totalCo2Kg.toLocaleString()} kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total CH4</span>
                      <span>{packageData.emissionsSummary.totalCh4Kg.toLocaleString()} kg</span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-2 mt-2">
                      <span className="text-muted-foreground">Records Computed</span>
                      <span>{packageData.emissionsSummary.recordCount}</span>
                    </div>
                  </div>
                </div>

                {/* Audit Action Box */}
                <div className="bg-card border border-border rounded-sm p-5 flex flex-col">
                  <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 border-b border-border pb-2 mb-4">
                    <ShieldCheck className="w-4 h-4 text-muted-foreground" /> Verifier Decision
                  </h3>
                  
                  <div className="flex-1 flex flex-col gap-4">
                    <Textarea 
                      placeholder="Enter verification rationale..." 
                      className="resize-none bg-background border-border font-mono text-xs h-24 rounded-sm"
                      value={rationale}
                      onChange={(e) => setRationale(e.target.value)}
                    />
                    
                    <div className="grid grid-cols-3 gap-2 mt-auto">
                      <button 
                        onClick={() => handleSubmit("REJECTED")}
                        disabled={decisionMutation.isPending}
                        className="bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 h-10 rounded-sm font-mono text-xs flex items-center justify-center gap-1 transition-colors"
                      >
                        <X className="w-3 h-3" /> REJECT
                      </button>
                      <button 
                        onClick={() => handleSubmit("PENDING_CLARIFICATION")}
                        disabled={decisionMutation.isPending}
                        className="bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500/20 h-10 rounded-sm font-mono text-xs flex items-center justify-center gap-1 transition-colors"
                      >
                        <HelpCircle className="w-3 h-3" /> CLARIFY
                      </button>
                      <button 
                        onClick={() => handleSubmit("APPROVED")}
                        disabled={decisionMutation.isPending}
                        className="bg-green-500/10 text-green-500 border border-green-500/20 hover:bg-green-500/20 h-10 rounded-sm font-mono text-xs flex items-center justify-center gap-1 transition-colors"
                      >
                        <Check className="w-3 h-3" /> APPROVE
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Decision History */}
              {packageData.decisions.length > 0 && (
                <div className="bg-card border border-border rounded-sm overflow-hidden">
                  <div className="bg-secondary/50 border-b border-border p-3 text-xs font-medium font-mono text-muted-foreground uppercase">
                    Prior Decisions
                  </div>
                  <div className="divide-y divide-border">
                    {packageData.decisions.map(dec => (
                      <div key={dec.id} className="p-4 flex flex-col sm:flex-row gap-4 justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${
                              dec.decision === 'APPROVED' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                              dec.decision === 'REJECTED' ? 'bg-destructive/10 text-destructive border-destructive/20' :
                              'bg-amber-500/10 text-amber-500 border-amber-500/20'
                            }`}>
                              {dec.decision}
                            </span>
                            <span className="text-xs text-muted-foreground font-mono">{format(new Date(dec.createdAt), "yyyy-MM-dd HH:mm")}</span>
                          </div>
                          <p className="text-sm text-foreground">{dec.rationale}</p>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono self-start bg-background px-2 py-1 rounded-sm border border-border">
                          {dec.verifierId}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
