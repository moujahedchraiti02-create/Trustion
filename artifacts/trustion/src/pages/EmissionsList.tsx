import { 
  useGetEmissions, getGetEmissionsQueryKey,
  useGetVessels, getGetVesselsQueryKey,
  GetEmissionsScope
} from "@workspace/api-client-react";
import { Link, useSearch } from "wouter";
import { Activity, Filter } from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

export default function EmissionsList() {
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const initialVesselId = searchParams.get('vesselId') ? Number(searchParams.get('vesselId')) : undefined;

  const [vesselId, setVesselId] = useState<number | undefined>(initialVesselId);
  const [scope, setScope] = useState<GetEmissionsScope>(null);

  const { data: vessels } = useGetVessels({ query: { queryKey: getGetVesselsQueryKey() } });
  const { data: emissions, isLoading } = useGetEmissions(
    { vesselId, scope },
    { query: { queryKey: getGetEmissionsQueryKey({ vesselId, scope }) } }
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-none p-6 border-b border-border bg-card">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary" />
              Emissions Explorer
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Computed multi-gas emissions records anchored to ledger evidence.</p>
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
              value={scope || "all"} 
              onValueChange={(v) => setScope(v === "all" ? null : v as GetEmissionsScope)}
            >
              <SelectTrigger className="w-[150px] h-9 rounded-sm bg-background border-border font-mono text-xs">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border rounded-sm">
                <SelectItem value="all" className="font-mono text-xs">ALL_SCOPES</SelectItem>
                <SelectItem value="WTW" className="font-mono text-xs">WTW</SelectItem>
                <SelectItem value="TTW" className="font-mono text-xs">TTW</SelectItem>
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
                <th className="px-4 py-3">Computed At</th>
                <th className="px-4 py-3">Vessel ID</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3 text-right">CO2 (kg)</th>
                <th className="px-4 py-3 text-right">CH4 (kg)</th>
                <th className="px-4 py-3 text-right">N2O (kg)</th>
                <th className="px-4 py-3 text-right text-primary">CO2e (kg)</th>
                <th className="px-4 py-3">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground font-mono">LOADING_EMISSIONS...</td></tr>
              ) : emissions?.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground font-mono">NO_RECORDS_FOUND</td></tr>
              ) : (
                emissions?.map(record => (
                  <tr key={record.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">
                      {format(new Date(record.computedAt), "yyyy-MM-dd HH:mm")}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/vessels/${record.vesselId}`} className="hover:underline text-foreground">
                        {record.vesselId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <span className={`px-2 py-0.5 rounded border ${record.scope === 'WTW' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-purple-500/10 text-purple-400 border-purple-500/20'}`}>
                        {record.scope}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{record.co2Kg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{record.ch4Kg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{record.n2oKg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-primary">{record.co2eKg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="px-4 py-3">
                      <Link href={`/ledger/${record.ledgerEntryId}`} className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors border-b border-dashed border-muted-foreground/50 hover:border-primary">
                        BLOCK_{record.ledgerEntryId.toString().padStart(6, '0')}
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
