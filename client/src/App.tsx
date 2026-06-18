import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Candidates from "@/pages/Candidates";
import CandidateDetail from "@/pages/CandidateDetail";
import Vacancies from "@/pages/Vacancies";
import Settings from "@/pages/Settings";
import Channel from "@/pages/Channel";
import Quizzes from "@/pages/Quizzes";
import Alerts from "@/pages/Alerts";
import Probation from "@/pages/Probation";
import Referrals from "@/pages/Referrals";
import VideoAnalysis from "@/pages/VideoAnalysis";
import ScorecardTemplates from "@/pages/ScorecardTemplates";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/candidates" component={Candidates} />
      <Route path="/candidates/:id" component={CandidateDetail} />
      <Route path="/candidates/:id/video/:videoId" component={VideoAnalysis} />
      <Route path="/scorecards/templates" component={ScorecardTemplates} />
      <Route path="/vacancies" component={Vacancies} />
      <Route path="/channel" component={Channel} />
      <Route path="/quizzes" component={Quizzes} />
      <Route path="/alerts" component={Alerts} />
      <Route path="/probation" component={Probation} />
      <Route path="/referrals" component={Referrals} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
