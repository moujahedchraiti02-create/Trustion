import { 
  useGetVessel, getGetVesselQueryKey,
  useGetVesselCompliance, getGetVesselComplianceQueryKey,
  useGetVesselEmissionsTrend, getGetVesselEmissionsTrendQueryKey,
  useGetLedgerEntries, getGetLedgerEntriesQueryKey,
} from "@workspace/api-client-react";
import { Link, useParams } from "wouter";
import { ArrowLeft, FileText, Anchor, BarChart, Database } from "lucide-react";
import { VesselStatusBadge, TrustBadge } from "@/components/Badges";
import { HashDisplay } from "@/components/HashDisplay";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

export default function VesselDetail() {
  const { id } = useParams();
  const vesselId = Number(id);

  const { data: vessel, isLoading: loadingVessel } = useGetVessel(vesselId, { 
    query: { enabled: !!vesselId, queryKey: getGetVesselQueryKey(vesselId) } 
  });
  
  const { data: compliance, isLoading: loadingCompliance } = useGetVesselCompliance(vesselId, {
    query: { enabled: !!vesselId, queryKey: getGetVesselComplianceQueryKey(vesselId) }
  });

  const { data: trend, isLoading: loadingTrend } = useGetVesselEmissionsTrend(vesselId, {
    query: { enabled: !!vesselId, queryKey: getGetVesselEmissionsTrendQueryKey(vesselId) }
  });

  const { data: ledgerEntries, isLoading: loadingLedger } = useGetLedgerEntries({ vesselId, limit: 10 }, {
    query: { enabled: !!vesselId, queryKey: getGetLedgerEntriesQueryKey({ vesselId, limit: 10 }) }
  });

  if (loadingVessel) {
    return <div className="p-8 text-center text-muted-foreground animate-pulse font-mono">LOADING_VESSEL_DATA...</div>;
  }

  if (!vessel) {
    return <div className="p-8 text-center text-destructive font-mono">ERR: VESSEL_NOT_FOUND</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="bg-card border-b border-border p-6 lg:p-8">
        <div className="max-w-6xl mx-auto">
          <Link href="/vessels" className="inline-flex items-center text-xs font-mono text-muted-foreground hover:text-primary mb-4 transition-colors">
            <ArrowLeft className="w-3 h-3 mr-1" />
            BACK_TO_ROSTER
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold tracking-tight">{vessel.name}</h1>
                <VesselStatusBadge status={vessel.status} />
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground font-mono">
                <span className="flex items-center gap-1"><Anchor className="w-4 h-4" /> IMO: {vessel.imoNumber}</span>
                <span>FLAG: {vessel.flag}</span>
                <span>TYPE: {vessel.vesselType}</span>
                <span>GT: {vessel.grossTonnage.toLocaleString()}</span>
              </div>
            </div>
            
            <div className="flex gap-2">
              <Link href={`/emissions?vesselId=${vessel.id}`} className="bg-secondary text-secondary-foreground hover:bg-secondary/80 px-4 py-2 rounded-sm text-sm font-medium transition-colors border border-border">
                View Emissions
              </Link>
              <Link href={`/ledger?vesselId=${vessel.id}`} className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-sm text-sm font-medium transition-colors border border-primary-border">
                Filter Ledger
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 lg:p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          
          {/* Top Row: Compliance & Quick Stats */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-card border border-border rounded-sm p-6 lg:col-span-1 flex flex-col">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2 mb-4">
                <FileText className="w-4 h-4" />
                Compliance Status {compliance?.reportingYear ? `(${compliance.reportingYear})` : ''}
              </h2>
              
              {loadingCompliance ? (
                <div className="animate-pulse space-y-4 flex-1">
                  <div className="h-10 bg-muted rounded w-1/2"></div>
                  <div className="h-4 bg-muted rounded w-full"></div>
                </div>
              ) : compliance ? (
                <div className="flex-1 flex flex-col">
                  <div className="mb-6">
                    <div className="text-3xl font-bold font-mono tracking-tight mb-1">
                      <span className={
                        compliance.overallStatus === 'COMPLIANT' ? 'text-green-500' : 
                        compliance.overallStatus === 'AT_RISK' ? 'text-amber-500' : 'text-destructive'
                      }>
                        {compliance.overallStatus}
                      </span>
                    </div>
                    {compliance.regulatoryProfile && (
                      <p className="text-xs text-muted-foreground font-mono">Profile: {compliance.regulatoryProfile}</p>
                    )}
                  </div>
                  
                  <div className="space-y-3 mt-auto">
                    <div>
                      <div className="flex justify-between text-xs mb-1 font-mono">
                        <span>Data Gap</span>
                        <span>{compliance.dataGapPct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(100, compliance.dataGapPct)}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1 font-mono">
                        <span>Estimated Data</span>
                        <span>{compliance.estimatedPct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, compliance.estimatedPct)}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm flex-1 flex items-center justify-center font-mono">NO_DATA</div>
              )}
            </div>

            <div className="bg-card border border-border rounded-sm p-6 lg:col-span-2">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2 mb-4">
                <BarChart className="w-4 h-4" />
                Emissions Trend (CO2e)
              </h2>
              <div className="h-64 w-full">
                {loadingTrend ? (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground font-mono animate-pulse">LOADING_CHART_DATA...</div>
                ) : trend && trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis 
                        dataKey="month" 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={12} 
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={12} 
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                      />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '0.125rem' }}
                        itemStyle={{ color: 'hsl(var(--foreground))', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                        labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '0.25rem' }}
                        formatter={(value: number) => [`${value.toLocaleString()} kg`, 'CO2e']}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="co2eKg" 
                        stroke="hsl(var(--primary))" 
                        strokeWidth={2}
                        dot={{ fill: 'hsl(var(--background))', stroke: 'hsl(var(--primary))', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--background))' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground font-mono">NO_TREND_DATA</div>
                )}
              </div>
            </div>
          </div>

          {/* Recent Ledger Entries */}
          <div>
            <div className="flex items-center justify-between border-b border-border pb-2 mb-4">
              <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                <Database className="w-5 h-5 text-muted-foreground" />
                Recent Evidence Stream
              </h2>
              <Link href={`/ledger?vesselId=${vessel.id}`} className="text-sm text-primary hover:underline font-mono">VIEW_FULL_LEDGER</Link>
            </div>
            
            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary/50 border-b border-border text-xs uppercase font-mono text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Time (GNSS)</th>
                    <th className="px-4 py-3">Event Type</th>
                    <th className="px-4 py-3">Trust</th>
                    <th className="px-4 py-3">Fuel (kg)</th>
                    <th className="px-4 py-3">Chain Hash</th>
                    <th className="px-4 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingLedger ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading stream...</td></tr>
                  ) : ledgerEntries?.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No entries recorded.</td></tr>
                  ) : (
                    ledgerEntries?.map(entry => (
                      <tr key={entry.id} className="hover:bg-accent/50 transition-colors group">
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                          {format(new Date(entry.timestampGnss), "yyyy-MM-dd HH:mm:ss")}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{entry.eventType}</td>
                        <td className="px-4 py-3">
                          <TrustBadge trust={entry.temporalTrust} />
                        </td>
                        <td className="px-4 py-3 font-mono">{entry.fuelMassKg.toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <HashDisplay hash={entry.chainHash} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/ledger/${entry.id}`} className="text-xs font-mono text-primary opacity-0 group-hover:opacity-100 hover:underline">
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
      </div>
    </div>
  );
}
