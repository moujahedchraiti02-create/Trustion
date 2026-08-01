import { 
  useGetLedgerEntries, getGetLedgerEntriesQueryKey,
  useGetVessels, getGetVesselsQueryKey,
  GetLedgerEntriesTemporalTrust
} from "@workspace/api-client-react";
import { TrustBadge, SignerBadge } from "@/components/Badges";
import { HashDisplay } from "@/components/HashDisplay";
import { Link, useSearch } from "wouter";
import { Database, Filter } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function LedgerList() {
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const initialVesselId = searchParams.get('vesselId') ? Number(searchParams.get('vesselId')) : undefined;

  const [vesselId, setVesselId] = useState<number | undefined>(initialVesselId);
  const [trust, setTrust] = useState<GetLedgerEntriesTemporalTrust>(null);

  const { data: vessels } = useGetVessels({ query: { queryKey: getGetVesselsQueryKey() } });
  const { data: entries, isLoading } = useGetLedgerEntries(
    { vesselId, temporalTrust: trust }, 
    { query: { queryKey: getGetLedgerEntriesQueryKey({ vesselId, temporalTrust: trust }) } }
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-none p-6 border-b border-border bg-card">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Database className="w-6 h-6 text-primary" />
              Evidence Ledger
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Append-only cryptographic record of all telemetry events.</p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono bg-background border border-border px-3 py-1.5 rounded-sm">
              <Filter className="w-4 h-4" /> FILTERS
            </div>
            
            <Select 
              value={vesselId ? vesselId.toString() : "all"} 
              onValueChange={(v) => setVesselId(v === "all" ? undefined : Number(v))}
            >
              <SelectTrigger className="w-[200px] h-9 rounded-sm bg-background border-border font-mono text-xs">
                <SelectValue placeholder="All Vessels" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border rounded-sm">
                <SelectItem value="all" className="font-mono text-xs">ALL_VESSELS</SelectItem>
                {vessels?.map(v => (
                  <SelectItem key={v.id} value={v.id.toString()} className="font-mono text-xs">
                    {v.imoNumber} - {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select 
              value={trust || "all"} 
              onValueChange={(v) => setTrust(v === "all" ? null : v as GetLedgerEntriesTemporalTrust)}
            >
              <SelectTrigger className="w-[180px] h-9 rounded-sm bg-background border-border font-mono text-xs">
                <SelectValue placeholder="Trust Level" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border rounded-sm">
                <SelectItem value="all" className="font-mono text-xs">ALL_TRUST_LEVELS</SelectItem>
                <SelectItem value="TRUSTED_GNSS" className="font-mono text-xs">TRUSTED_GNSS</SelectItem>
                <SelectItem value="BACKFILL" className="font-mono text-xs">BACKFILL</SelectItem>
                <SelectItem value="DRIFT_WARNING" className="font-mono text-xs">DRIFT_WARNING</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="bg-card border border-border rounded-sm">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-secondary/50 border-b border-border text-xs uppercase font-mono text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Chain Hash</th>
                <th className="px-4 py-3">Time (GNSS)</th>
                <th className="px-4 py-3">Vessel</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Signer Mode</th>
                <th className="px-4 py-3">Trust</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground font-mono">LOADING_LEDGER...</td></tr>
              ) : entries?.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground font-mono">NO_ENTRIES_FOUND</td></tr>
              ) : (
                entries?.map(entry => (
                  <tr key={entry.id} className="hover:bg-accent/30 transition-colors group">
                    <td className="px-4 py-3">
                      <HashDisplay hash={entry.chainHash} className="font-bold text-primary" />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {format(new Date(entry.timestampGnss), "yyyy-MM-dd HH:mm:ss")}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/vessels/${entry.vesselId}`} className="hover:underline">
                        {entry.vesselName || `ID:${entry.vesselId}`}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{entry.eventType}</td>
                    <td className="px-4 py-3">
                      <SignerBadge mode={entry.signerMode} />
                    </td>
                    <td className="px-4 py-3">
                      <TrustBadge trust={entry.temporalTrust} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/ledger/${entry.id}`} className="text-xs font-mono bg-secondary hover:bg-secondary/80 text-secondary-foreground px-2 py-1 rounded-sm border border-border transition-colors">
                        INSPECT
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
