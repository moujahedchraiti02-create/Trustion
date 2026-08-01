import { 
  useGetLedgerEntry, getGetLedgerEntryQueryKey
} from "@workspace/api-client-react";
import { TrustBadge, SignerBadge } from "@/components/Badges";
import { HashDisplay } from "@/components/HashDisplay";
import { Link, useParams } from "wouter";
import { ArrowLeft, Cpu, Activity, CheckCircle2, ShieldAlert } from "lucide-react";
import { format } from "date-fns";

export default function LedgerDetail() {
  const { id } = useParams();
  const entryId = Number(id);

  const { data: detail, isLoading } = useGetLedgerEntry(entryId, { 
    query: { enabled: !!entryId, queryKey: getGetLedgerEntryQueryKey(entryId) } 
  });

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground animate-pulse font-mono">LOADING_BLOCK...</div>;
  }

  if (!detail) {
    return <div className="p-8 text-center text-destructive font-mono">ERR: ENTRY_NOT_FOUND</div>;
  }

  const { entry, merkleProof, chainValid } = detail;

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">
          <Link href="/ledger" className="inline-flex items-center text-xs font-mono text-muted-foreground hover:text-primary mb-4 transition-colors">
            <ArrowLeft className="w-3 h-3 mr-1" />
            BACK_TO_LEDGER
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight mb-2 font-mono flex items-center gap-2">
                BLOCK_{entry.id.toString().padStart(6, '0')}
              </h1>
              <div className="flex items-center gap-2">
                <HashDisplay hash={entry.chainHash} maxLength={24} className="text-primary text-sm" />
              </div>
            </div>
            
            <div className="flex flex-col items-end gap-2">
              {chainValid ? (
                <span className="flex items-center gap-2 text-green-400 font-mono text-sm bg-green-500/10 px-3 py-1 rounded-sm border border-green-500/20">
                  <CheckCircle2 className="w-4 h-4" />
                  CHAIN_VALID
                </span>
              ) : (
                <span className="flex items-center gap-2 text-destructive font-mono text-sm bg-destructive/10 px-3 py-1 rounded-sm border border-destructive/20">
                  <ShieldAlert className="w-4 h-4" />
                  CHAIN_BROKEN
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 lg:p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          
          {/* Metadata Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card border border-border p-5 rounded-sm space-y-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-mono border-b border-border pb-2">Context Data</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground font-mono mb-1">Vessel</div>
                  <Link href={`/vessels/${entry.vesselId}`} className="font-medium hover:underline">
                    {entry.vesselName || `ID:${entry.vesselId}`}
                  </Link>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground font-mono mb-1">Event Type</div>
                  <div className="font-mono text-sm">{entry.eventType}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground font-mono mb-1">Time (GNSS)</div>
                  <div className="font-mono text-sm">{format(new Date(entry.timestampGnss), "yyyy-MM-dd HH:mm:ss")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground font-mono mb-1">Server Ingest</div>
                  <div className="font-mono text-sm">{format(new Date(entry.createdAt), "yyyy-MM-dd HH:mm:ss")}</div>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border p-5 rounded-sm space-y-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-mono border-b border-border pb-2">Telemetry Body</h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground font-mono mb-1">Fuel Type</div>
                  <div className="font-mono text-sm">{entry.fuelType}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground font-mono mb-1">Fuel Mass</div>
                  <div className="font-mono text-sm">{entry.fuelMassKg.toLocaleString()} kg</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground font-mono mb-1">Engine Load</div>
                  <div className="font-mono text-sm">{entry.engineLoadPct}%</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground font-mono mb-1">Coordinates</div>
                  <div className="font-mono text-sm">
                    {entry.positionLat ? entry.positionLat.toFixed(4) : '--'}, {entry.positionLon ? entry.positionLon.toFixed(4) : '--'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Cryptographic Proof */}
          <div className="bg-card border border-border p-5 rounded-sm">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-mono border-b border-border pb-2 mb-4">Cryptographic Integrity</h3>
            
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-3">
                  <div className="flex justify-between items-center bg-background border border-border p-3 rounded-sm">
                    <span className="text-xs font-mono text-muted-foreground">Temporal Trust</span>
                    <TrustBadge trust={entry.temporalTrust} />
                  </div>
                  <div className="flex justify-between items-center bg-background border border-border p-3 rounded-sm">
                    <span className="text-xs font-mono text-muted-foreground">Signer Mode</span>
                    <SignerBadge mode={entry.signerMode} />
                  </div>
                </div>
                
                <div className="flex-1 space-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground font-mono mb-1">Raw Content Hash</div>
                    <div className="bg-background border border-border p-2 rounded-sm text-xs font-mono break-all text-muted-foreground">
                      {entry.rawHash}
                    </div>
                  </div>
                  {entry.signature && (
                    <div>
                      <div className="text-xs text-muted-foreground font-mono mb-1">Digital Signature</div>
                      <div className="bg-background border border-border p-2 rounded-sm text-xs font-mono break-all text-primary/70">
                        {entry.signature}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground font-mono mb-2">Merkle Path</div>
                <div className="bg-background border border-border rounded-sm p-4 space-y-2 font-mono text-xs overflow-x-auto">
                  <div className="flex items-center gap-2 text-primary mb-1">
                    <Cpu className="w-4 h-4" /> Root / Chain Head
                  </div>
                  {merkleProof.map((hash, i) => (
                    <div key={i} className="flex items-center gap-2 pl-4 text-muted-foreground border-l-2 border-border ml-2">
                      <div className="w-4 h-[1px] bg-border" />
                      {hash}
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pl-4 text-foreground border-l-2 border-primary ml-2 mt-2">
                    <div className="w-4 h-[1px] bg-primary" />
                    <span className="font-bold">{entry.chainHash}</span> <span className="text-muted-foreground">(Current)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
