import { 
  useGetVessels, getGetVesselsQueryKey,
} from "@workspace/api-client-react";
import { VesselStatusBadge } from "@/components/Badges";
import { Link } from "wouter";
import { Ship, Search, Plus } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

export default function VesselsList() {
  const { data: vessels, isLoading } = useGetVessels({ query: { queryKey: getGetVesselsQueryKey() } });
  const [search, setSearch] = useState("");

  const filteredVessels = vessels?.filter(v => 
    v.name.toLowerCase().includes(search.toLowerCase()) || 
    v.imoNumber.includes(search)
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-none p-6 border-b border-border bg-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Ship className="w-6 h-6 text-primary" />
              Fleet Roster
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Monitored vessels and reporting status.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search IMO or name..." 
                className="pl-8 bg-background border-border h-9 rounded-sm font-mono text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {/* Action button disabled until endpoint available */}
            <button className="h-9 px-4 bg-primary text-primary-foreground font-medium text-sm rounded-sm flex items-center gap-2 hover:bg-primary/90 opacity-50 cursor-not-allowed" title="Not available">
              <Plus className="w-4 h-4" />
              Register Vessel
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="bg-card border border-border rounded-sm">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/50 border-b border-border text-xs uppercase font-mono text-muted-foreground">
              <tr>
                <th className="px-6 py-4">IMO Number</th>
                <th className="px-6 py-4">Vessel Name</th>
                <th className="px-6 py-4">Flag</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      Loading roster...
                    </div>
                  </td>
                </tr>
              ) : filteredVessels?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No vessels found.</td>
                </tr>
              ) : (
                filteredVessels?.map(vessel => (
                  <tr key={vessel.id} className="hover:bg-accent/30 transition-colors group">
                    <td className="px-6 py-4 font-mono font-medium">{vessel.imoNumber}</td>
                    <td className="px-6 py-4 font-semibold text-foreground">{vessel.name}</td>
                    <td className="px-6 py-4 font-mono text-xs">{vessel.flag}</td>
                    <td className="px-6 py-4 text-muted-foreground">{vessel.vesselType}</td>
                    <td className="px-6 py-4">
                      <VesselStatusBadge status={vessel.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link 
                        href={`/vessels/${vessel.id}`}
                        className="text-xs font-mono text-primary opacity-0 group-hover:opacity-100 hover:underline transition-opacity"
                      >
                        VIEW_DETAILS
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
