import { Link } from "wouter";
import { 
  useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useGetDashboardAlertBreakdown, getGetDashboardAlertBreakdownQueryKey,
  useGetDashboardRecentEvents, getGetDashboardRecentEventsQueryKey,
  useGetLedgerChainStatus, getGetLedgerChainStatusQueryKey
} from "@workspace/api-client-react";
import { IntegrityBadge, SeverityBadge, TrustBadge } from "@/components/Badges";
import { HashDisplay } from "@/components/HashDisplay";
import { Activity, BellRing, Database, Settings2, ShieldCheck, Ship } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: breakdown, isLoading: loadingBreakdown } = useGetDashboardAlertBreakdown({ query: { queryKey: getGetDashboardAlertBreakdownQueryKey() } });
  const { data: recentEvents, isLoading: loadingEvents } = useGetDashboardRecentEvents({ query: { queryKey: getGetDashboardRecentEventsQueryKey() } });
  const { data: chainStatus, isLoading: loadingChain } = useGetLedgerChainStatus({ query: { queryKey: getGetLedgerChainStatusQueryKey() } });

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">Fleet Overview</h1>
          <p className="text-muted-foreground text-sm">System-wide monitoring of carbon evidence and alert states.</p>
        </div>

        {/* Top Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard 
            title="Total Co2e Monitored" 
            value={loadingSummary ? "..." : `${(summary?.totalCo2eKg || 0).toLocaleString()} kg`}
            icon={Activity}
            description="Across all active vessels"
          />
          <StatCard 
            title="Active Vessels" 
            value={loadingSummary ? "..." : `${summary?.activeVessels || 0} / ${summary?.totalVessels || 0}`}
            icon={Ship}
            description="Currently reporting telemetry"
          />
          <StatCard 
            title="Open Alerts" 
            value={loadingSummary ? "..." : summary?.openAlerts.toString() || "0"}
            icon={BellRing}
            description="Requires attention"
          />
          <StatCard 
            title="Chain Integrity" 
            value={
              loadingChain ? "..." : 
              <IntegrityBadge status={chainStatus?.integrityStatus || "UNKNOWN"} />
            }
            icon={ShieldCheck}
            description={`${chainStatus?.totalEntries.toLocaleString() || 0} entries anchored`}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Activity Feed */}
          <div className="col-span-1 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-lg font-semibold tracking-tight">Recent Ledger Events</h2>
              <Link href="/ledger" className="text-sm text-primary hover:underline font-mono">VIEW_ALL</Link>
            </div>
            
            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary/50 border-b border-border text-xs uppercase font-mono text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Vessel</th>
                    <th className="px-4 py-3">Event</th>
                    <th className="px-4 py-3">Trust</th>
                    <th className="px-4 py-3">Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingEvents ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading feed...</td></tr>
                  ) : recentEvents?.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No recent events.</td></tr>
                  ) : (
                    recentEvents?.map(event => (
                      <tr key={event.id} className="hover:bg-accent/50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                          {format(new Date(event.timestampGnss), "yyyy-MM-dd HH:mm:ss")}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <Link href={`/vessels/${event.vesselId}`} className="hover:underline">
                            {event.vesselName || `Vessel #${event.vesselId}`}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{event.eventType}</td>
                        <td className="px-4 py-3">
                          <TrustBadge trust={event.temporalTrust} />
                        </td>
                        <td className="px-4 py-3">
                          <HashDisplay hash={event.chainHash} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sidebar Modules */}
          <div className="space-y-8">
            {/* Alert Breakdown */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <h2 className="text-lg font-semibold tracking-tight">Alert Breakdown</h2>
                <Link href="/alerts" className="text-sm text-primary hover:underline font-mono">EXPLORE</Link>
              </div>
              <div className="bg-card border border-border rounded-sm p-4 space-y-4">
                {loadingBreakdown ? (
                  <div className="animate-pulse flex space-y-2 flex-col">
                    <div className="h-4 bg-muted rounded w-full"></div>
                    <div className="h-4 bg-muted rounded w-2/3"></div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center">
                      <SeverityBadge severity="THRESHOLD_EXCEEDED" />
                      <span className="font-mono">{breakdown?.thresholdExceeded || 0}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <SeverityBadge severity="LEGAL_WARNING" />
                      <span className="font-mono">{breakdown?.legalWarning || 0}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <SeverityBadge severity="WATCH" />
                      <span className="font-mono">{breakdown?.watch || 0}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold tracking-tight border-b border-border pb-2">Operations</h2>
              <div className="grid grid-cols-2 gap-2">
                <Link href="/auditor" className="bg-card border border-border p-3 rounded-sm hover:bg-accent hover:border-primary/50 transition-colors text-center group">
                  <ShieldCheck className="w-5 h-5 mx-auto mb-2 text-muted-foreground group-hover:text-primary transition-colors" />
                  <span className="text-xs font-medium block">Auditor Gateway</span>
                </Link>
                <Link href="/regulatory-profiles" className="bg-card border border-border p-3 rounded-sm hover:bg-accent hover:border-primary/50 transition-colors text-center group">
                  <Settings2 className="w-5 h-5 mx-auto mb-2 text-muted-foreground group-hover:text-primary transition-colors" />
                  <span className="text-xs font-medium block">Reg Profiles</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, description }: any) {
  return (
    <div className="bg-card border border-border p-4 rounded-sm flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{title}</h3>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="mt-auto">
        <div className="text-2xl font-bold tracking-tight mb-1">{value}</div>
        <p className="text-xs text-muted-foreground font-mono">{description}</p>
      </div>
    </div>
  );
}
