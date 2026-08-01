import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Ship, 
  Database, 
  Activity, 
  FileCheck, 
  BellRing, 
  ShieldCheck
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/vessels", label: "Fleet Roster", icon: Ship },
  { href: "/ledger", label: "Evidence Ledger", icon: Database },
  { href: "/emissions", label: "Emissions Log", icon: Activity },
  { href: "/regulatory-profiles", label: "Regulatory Rules", icon: FileCheck },
  { href: "/alerts", label: "Materiality Alerts", icon: BellRing },
  { href: "/auditor", label: "Auditor Gateway", icon: ShieldCheck },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex min-h-screen w-full flex-col lg:flex-row bg-background dark">
      {/* Sidebar */}
      <aside className="w-full lg:w-64 border-r border-border bg-card flex-shrink-0 flex flex-col">
        <div className="h-14 lg:h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-3 text-primary">
            <ShieldCheck className="w-5 h-5" />
            <span className="font-mono font-bold tracking-tight text-sm">S³V TRUSTION</span>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="grid gap-1 px-4 text-sm font-medium">
            {NAV_ITEMS.map((item) => {
              const isActive = location === item.href || 
                               (item.href !== "/" && location.startsWith(item.href));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-sm px-3 py-2 transition-colors",
                      isActive 
                        ? "bg-primary/10 text-primary border border-primary/20" 
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="p-4 border-t border-border mt-auto">
          <div className="flex items-center gap-3 px-3 py-2 rounded-sm bg-secondary text-secondary-foreground text-xs font-mono">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            SYS_ONLINE_SECURE
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
