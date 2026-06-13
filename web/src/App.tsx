import { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ChatView } from './components/ChatView';
import { PlanView } from './components/PlanView';
import { AgentView } from './components/AgentView';
import { Composer } from './components/Composer';
import { OllamaView } from './components/OllamaView';
import { LibraryView } from './components/LibraryView';
import { MailpitView } from './components/MailpitView';
import { ConnectorsView } from './components/ConnectorsView';
import { JobSearchView } from './components/JobSearchView';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthGate } from './components/AuthGate';
import { InstallPrompt } from './components/InstallPrompt';

function useTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === 'dark'
        || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('dark', dark);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const appView = useStore((s) => s.appView);
  const setAppView = useStore((s) => s.setAppView);
  const mode = useStore((s) => s.mode);
  const refreshHealth = useStore((s) => s.refreshHealth);
  const loadModels = useStore((s) => s.loadModels);
  const loadConversations = useStore((s) => s.loadConversations);
  const loadAdmin = useStore((s) => s.loadAdmin);

  useTheme();

  useEffect(() => {
    void refreshHealth();
    void loadModels();
    void loadConversations();
    void loadAdmin();
    const interval = setInterval(() => void refreshHealth(), 15_000);
    return () => clearInterval(interval);
  }, [refreshHealth, loadModels, loadConversations, loadAdmin]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const syncSidebar = () => setSidebarOpen(!media.matches);
    syncSidebar();
    media.addEventListener('change', syncSidebar);
    return () => media.removeEventListener('change', syncSidebar);
  }, []);

  const closeSidebarOnMobile = () => {
    if (window.matchMedia('(max-width: 767px)').matches) setSidebarOpen(false);
  };

  return (
    <AuthGate>
      <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground font-sans selection:bg-primary/20">
        {sidebarOpen && (
          <button
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm md:hidden"
          />
        )}
        <Sidebar
          isOpen={sidebarOpen}
          toggle={() => setSidebarOpen((v) => !v)}
          onNavigate={closeSidebarOnMobile}
        />

        <div className="flex-1 flex flex-col h-full relative min-w-0">
          <Header sidebarOpen={sidebarOpen} toggleSidebar={() => setSidebarOpen((v) => !v)} onOpenSettings={() => setAppView('connectors')} />

          <div className="flex-1 overflow-y-auto custom-scrollbar relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${appView}:${mode}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="min-h-full"
              >
                {appView === 'ollama' && <OllamaView />}
                {appView === 'library' && <LibraryView />}
                {appView === 'mailpit' && <MailpitView />}
                {appView === 'connectors' && <ConnectorsView />}
                {appView === 'jobs' && <JobSearchView />}
                {appView === 'chat' && mode === 'Chat' && <ChatView />}
                {appView === 'chat' && mode === 'Plan' && <PlanView />}
                {appView === 'chat' && mode === 'Agent' && <AgentView />}
              </motion.div>
            </AnimatePresence>
          </div>

          {(appView === 'chat') && <Composer />}
        </div>

        <InstallPrompt />
      </div>
    </AuthGate>
  );
}
