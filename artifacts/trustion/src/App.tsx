import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from '@/components/layout/Shell';

// Pages
import Dashboard from '@/pages/Dashboard';
import VesselsList from '@/pages/VesselsList';
import VesselDetail from '@/pages/VesselDetail';
import LedgerList from '@/pages/LedgerList';
import LedgerDetail from '@/pages/LedgerDetail';
import EmissionsList from '@/pages/EmissionsList';
import ProfilesList from '@/pages/ProfilesList';
import AlertsList from '@/pages/AlertsList';
import AuditorGateway from '@/pages/AuditorGateway';
import SigningKeyHistory from '@/pages/SigningKeyHistory';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/vessels" component={VesselsList} />
        <Route path="/vessels/:id" component={VesselDetail} />
        <Route path="/ledger" component={LedgerList} />
        <Route path="/ledger/:id" component={LedgerDetail} />
        <Route path="/emissions" component={EmissionsList} />
        <Route path="/regulatory-profiles" component={ProfilesList} />
        <Route path="/alerts" component={AlertsList} />
        <Route path="/auditor" component={AuditorGateway} />
        <Route path="/auditor/signing-keys" component={SigningKeyHistory} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
