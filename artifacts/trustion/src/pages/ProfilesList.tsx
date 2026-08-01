import { 
  useGetRegulatoryProfiles, getGetRegulatoryProfilesQueryKey
} from "@workspace/api-client-react";
import { FileCheck } from "lucide-react";
import { format } from "date-fns";

export default function ProfilesList() {
  const { data: profiles, isLoading } = useGetRegulatoryProfiles({ 
    query: { queryKey: getGetRegulatoryProfilesQueryKey() } 
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      <div className="flex-none p-6 border-b border-border bg-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FileCheck className="w-6 h-6 text-primary" />
              Regulatory Profiles
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Versioned configurations for emissions calculation parameters.</p>
          </div>
          <button className="h-9 px-4 bg-primary text-primary-foreground font-medium text-sm rounded-sm hover:bg-primary/90 opacity-50 cursor-not-allowed" title="Creation restricted to admins">
            Draft New Profile
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {isLoading ? (
            <div className="text-center text-muted-foreground font-mono animate-pulse py-12">LOADING_PROFILES...</div>
          ) : profiles?.length === 0 ? (
            <div className="text-center text-muted-foreground font-mono py-12 border border-dashed border-border rounded-sm">NO_PROFILES_CONFIGURED</div>
          ) : (
            profiles?.map((profile) => (
              <div key={profile.id} className="bg-card border border-border rounded-sm overflow-hidden">
                <div className="border-b border-border p-4 bg-secondary/20 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-bold text-lg tracking-tight">{profile.name}</h3>
                      <span className="bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded text-xs font-mono">
                        v{profile.version}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono flex items-center gap-4">
                      <span>CODE: {profile.code}</span>
                      <span>JURISDICTION: {profile.jurisdiction}</span>
                      <span>EFFECTIVE: {format(new Date(profile.effectiveDate), "yyyy-MM-dd")}</span>
                    </div>
                  </div>
                  <div className="text-xs font-mono text-muted-foreground bg-background border border-border px-3 py-2 rounded-sm">
                    ID_{profile.id.toString().padStart(4, '0')}
                  </div>
                </div>
                
                <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground font-mono mb-1">CO2 Factor</div>
                    <div className="font-mono">{profile.co2Factor}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground font-mono mb-1">CH4 GWP</div>
                    <div className="font-mono">{profile.ch4Gwp}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground font-mono mb-1">N2O GWP</div>
                    <div className="font-mono">{profile.n2oGwp}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground font-mono mb-1">Methane Slip Def.</div>
                    <div className="font-mono">{profile.methaneSlipDefault}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground font-mono mb-1">Max Data Gap</div>
                    <div className="font-mono text-destructive">{profile.maxDataGapPct}%</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
