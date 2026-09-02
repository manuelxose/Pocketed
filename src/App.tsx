import { useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { OnboardingModal } from './pages/Onboarding';
import { useOnboardingQuery } from './hooks/useOnboarding';
import { DashboardPage } from './pages/Dashboard';
import { MainEnginePage } from './pages/MainEngine';
import { SettingsPage } from './pages/Settings';
import { PositionsPage } from './pages/Positions';
import { SignalsPage } from './pages/Signals';
import { HistoryPage } from './pages/History';
import { ProfilesPage } from './pages/Profiles';
import { ApiKeysPage } from './pages/ApiKeys';
import { AboutPage } from './pages/About';
import { GuidePage } from './pages/Guide';
import { VisualizerPage } from './pages/Visualizer';
import { Crypto15mPage } from './pages/Crypto15m';
import { CopyTradingPage } from './pages/CopyTrading';
import { AccountsPage } from './pages/Accounts';
import { BacktestPage } from './pages/Backtest';
import { TerminalPage } from './pages/Terminal';
import { ScriptsPage } from './pages/Scripts';
import { SessionKeyPage } from './pages/SessionKey';

export type PageId =
  | 'dashboard' | 'main' | 'positions' | 'signals' | 'history'
  | 'profiles' | 'settings' | 'api' | 'guide' | 'about'
  | 'visualizer' | 'crypto15m' | 'copy' | 'accounts' | 'backtest'
  | 'terminal' | 'scripts' | 'sessionkey';

export default function App() {
  return <Shell />;
}

function Shell() {
  const [page, setPage] = useState<PageId>('dashboard');
  const { data: onboarding } = useOnboardingQuery();

  const showOnboarding = onboarding ? !onboarding.acceptedDisclaimer : false;

  return (
    <div className="flex h-full w-full flex-col bg-pocketed-radial bg-pocketed-void">
      <TitleBar />
      <div className="flex h-[calc(100%-2.25rem)] w-full">
        <Sidebar page={page} setPage={setPage} />
        <main className="relative flex flex-1 flex-col overflow-hidden">
          <TopBar />
          <div className="flex-1 overflow-hidden bg-pocketed-radial-r">
            <PageRouter page={page} setPage={setPage} />
          </div>
        </main>
      </div>
      {showOnboarding && <OnboardingModal onDone={() => setPage('api')} />}
    </div>
  );
}

function PageRouter({ page, setPage }: { page: PageId; setPage: (p: PageId) => void }) {
  switch (page) {
    case 'dashboard': return <DashboardPage onNav={setPage} />;
    case 'main': return <MainEnginePage />;
    case 'positions': return <PositionsPage />;
    case 'signals': return <SignalsPage />;
    case 'history': return <HistoryPage />;
    case 'profiles': return <ProfilesPage />;
    case 'settings': return <SettingsPage />;
    case 'api': return <ApiKeysPage />;
    case 'sessionkey': return <SessionKeyPage />;
    case 'guide': return <GuidePage />;
    case 'about': return <AboutPage />;
    case 'visualizer': return <VisualizerPage />;
    case 'terminal': return <TerminalPage />;
    case 'crypto15m': return <Crypto15mPage />;
    case 'copy': return <CopyTradingPage />;
    case 'accounts': return <AccountsPage />;
    case 'backtest': return <BacktestPage />;
    case 'scripts': return <ScriptsPage />;
    default: return <DashboardPage onNav={setPage} />;
  }
}
