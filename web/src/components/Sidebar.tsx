import { Edit3, MessageCircle, Trash2, PanelLeftClose, Plug, Search, Library, Cpu, ArchiveRestore, Mail, Briefcase, Activity, Settings, LogOut } from 'lucide-react';
import { useMemo, useState, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import { BrandLogo } from './BrandLogo';

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function Sidebar({ isOpen, toggle, onNavigate }: { isOpen: boolean; toggle: () => void; onNavigate?: () => void }) {
  const conversations = useStore((s) => s.conversations);
  const archivedIds = useStore((s) => s.archivedIds);
  const activeId = useStore((s) => s.activeConversationId);
  const selectConversation = useStore((s) => s.selectConversation);
  const newConversation = useStore((s) => s.newConversation);
  const connectors = useStore((s) => s.connectors);
  const appView = useStore((s) => s.appView);
  const setAppView = useStore((s) => s.setAppView);
  const admin = useStore((s) => s.admin);
  const logoutAdmin = useStore((s) => s.logoutAdmin);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileOpen]);

  // Recents only shows non-archived conversations
  const recentConversations = useMemo(
    () => conversations.filter((c) => !archivedIds.includes(c.id)),
    [conversations, archivedIds],
  );

  const navigate = (view: Parameters<typeof setAppView>[0]) => {
    if (!isOpen) toggle();
    setAppView(view);
    onNavigate?.();
  };

  const createConversation = () => {
    setAppView('chat');
    void newConversation();
    onNavigate?.();
  };

  const selectAndNavigate = (id: string) => {
    void selectConversation(id);
    setAppView('chat');
    onNavigate?.();
  };

  return (
    <>
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col bg-background border-r border-border transition-all duration-300 md:relative md:z-auto md:flex-shrink-0',
          isOpen ? 'w-[min(20rem,86vw)] translate-x-0 md:w-72' : 'w-[min(20rem,86vw)] -translate-x-full md:w-[72px] md:translate-x-0',
        )}
      >
        <div className={cn('p-5 flex items-center gap-2', !isOpen && 'justify-center p-4')}>
          <BrandLogo compact={!isOpen} className={isOpen ? 'h-10 w-[185px]' : 'h-9 w-9'} />
          {isOpen && (
            <button onClick={toggle} className="p-2 hover:bg-muted rounded-md ml-auto text-muted-foreground hover:text-foreground transition-colors" title="Close sidebar">
              <PanelLeftClose size={18} />
            </button>
          )}
        </div>

        {isOpen ? (
          <>
            <div className="px-3 pb-3 space-y-1">
              <button onClick={createConversation} className="flex items-center gap-3 w-full p-2.5 rounded-xl text-sm transition-colors bg-muted hover:bg-muted/80">
                <Edit3 size={18} /> New chat
              </button>
              <button
                onClick={() => navigate('chat')}
                className="flex items-center gap-3 w-full p-2.5 rounded-xl text-sm hover:bg-muted transition-colors"
              >
                <Search size={18} /> Search chats
              </button>
              <button
                onClick={() => navigate('library')}
                className={cn('flex items-center gap-3 w-full p-2.5 rounded-xl text-sm hover:bg-muted transition-colors', appView === 'library' && 'bg-muted')}
              >
                <Library size={18} /> Library
              </button>
              <button
                onClick={() => navigate('ollama')}
                className={cn('flex items-center gap-3 w-full p-2.5 rounded-xl text-sm hover:bg-muted transition-colors', appView === 'ollama' && 'bg-muted')}
              >
                <Cpu size={18} /> Ollama
              </button>
              <button
                onClick={() => navigate('mailpit')}
                className={cn('flex items-center gap-3 w-full p-2.5 rounded-xl text-sm hover:bg-muted transition-colors', appView === 'mailpit' && 'bg-muted')}
              >
                <Mail size={18} /> Mailpit
              </button>
              <button
                onClick={() => navigate('connectors')}
                className={cn('flex items-center gap-3 w-full p-2.5 rounded-xl text-sm hover:bg-muted transition-colors', appView === 'connectors' && 'bg-muted')}
              >
                <Plug size={18} /> MCP Connectors
                {connectors.length > 0 && <span className="ml-auto text-xs font-mono text-muted-foreground">{connectors.length}</span>}
              </button>
              <button
                onClick={() => navigate('jobs')}
                className={cn('flex items-center gap-3 w-full p-2.5 rounded-xl text-sm hover:bg-muted transition-colors', appView === 'jobs' && 'bg-muted')}
              >
                <Briefcase size={18} /> Job Search Agent
              </button>
              <button
                onClick={() => navigate('observability')}
                className={cn('flex items-center gap-3 w-full p-2.5 rounded-xl text-sm hover:bg-muted transition-colors', appView === 'observability' && 'bg-muted')}
              >
                <Activity size={18} /> Observability
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 pt-5 space-y-1">
              <div className="px-2 mb-3">
                <div className="text-sm font-semibold">Recents</div>
              </div>

              {recentConversations.map((c) => (
                <ChatRow key={c.id} id={c.id} title={c.title} active={activeId === c.id}
                  onSelect={() => selectAndNavigate(c.id)}
                />
              ))}

              {recentConversations.length === 0 && (
                <div className="text-xs text-muted-foreground px-2 py-4 text-center">No conversations yet</div>
              )}
            </div>

            {/* Profile footer */}
            <div className="border-t border-border p-2 relative" ref={profileRef}>
              {/* Popup menu */}
              {profileOpen && (
                <div className="absolute bottom-full left-2 right-2 mb-1 rounded-xl border border-border bg-popover shadow-xl overflow-hidden z-50">
                  <div className="py-1">
                    <button
                      onClick={() => { setProfileOpen(false); navigate('settings'); }}
                      className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors"
                    >
                      <Settings size={15} /> Settings
                    </button>
                  </div>
                  <div className="border-t border-border py-1">
                    <button
                      onClick={() => { setProfileOpen(false); logoutAdmin(); }}
                      className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <LogOut size={15} /> Log Out
                    </button>
                  </div>
                </div>
              )}

              {/* Profile row */}
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2.5 w-full rounded-lg px-2 py-2 hover:bg-muted transition-colors group text-left"
              >
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center flex-shrink-0 select-none">
                  {initials(admin?.fullName ?? 'A')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate leading-tight">{admin?.fullName ?? 'Admin'}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">Free Plan</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); navigate('settings'); }}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                  title="Settings"
                >
                  <Settings size={14} />
                </button>
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center py-3 gap-1">
            <div className="flex flex-col items-center gap-1 flex-1">
              {(
                [
                  { view: null,           icon: Edit3,     title: 'New chat',         action: createConversation },
                  { view: 'library',      icon: Library,   title: 'Library',          action: () => navigate('library') },
                  { view: 'ollama',       icon: Cpu,       title: 'Ollama',           action: () => navigate('ollama') },
                  { view: 'mailpit',      icon: Mail,      title: 'Mailpit',          action: () => navigate('mailpit') },
                  { view: 'connectors',   icon: Plug,      title: 'MCP Connectors',   action: () => navigate('connectors') },
                  { view: 'jobs',         icon: Briefcase, title: 'Job Search Agent', action: () => navigate('jobs') },
                  { view: 'observability',icon: Activity,  title: 'Observability',    action: () => navigate('observability') },
                  { view: 'settings',     icon: Settings,  title: 'Settings',         action: () => navigate('settings') },
                ] as const
              ).map(({ view, icon: Icon, title, action }) => (
                <button
                  key={title}
                  onClick={action}
                  title={title}
                  className={cn(
                    'flex items-center justify-center w-10 h-10 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground',
                    view && appView === view && 'bg-muted text-foreground',
                  )}
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>
            {/* Profile avatar in collapsed state */}
            <div className="pb-1 border-t border-border pt-2 w-full flex justify-center" ref={profileRef}>
              {profileOpen && (
                <div className="absolute bottom-14 left-[72px] w-48 rounded-xl border border-border bg-popover shadow-xl overflow-hidden z-50">
                  <div className="py-1">
                    <button onClick={() => { setProfileOpen(false); navigate('settings'); }} className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors">
                      <Settings size={15} /> Settings
                    </button>
                  </div>
                  <div className="border-t border-border py-1">
                    <button onClick={() => { setProfileOpen(false); logoutAdmin(); }} className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <LogOut size={15} /> Log Out
                    </button>
                  </div>
                </div>
              )}
              <button
                onClick={() => setProfileOpen((v) => !v)}
                title={admin?.fullName ?? 'Profile'}
                className="w-9 h-9 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center hover:opacity-90 transition-opacity select-none"
              >
                {initials(admin?.fullName ?? 'A')}
              </button>
            </div>
          </div>
        )}
      </div>

      {!isOpen && (
        <div className="absolute left-[72px] top-4 z-40 hidden md:block">
          <button onClick={toggle} className="p-2 bg-background border border-border rounded-lg shadow-sm hover:bg-muted transition-colors" title="Open sidebar">
            <PanelLeftClose size={17} className="rotate-180" />
          </button>
        </div>
      )}

    </>
  );
}

function ChatRow({ title, active, onSelect }: {
  id: string; title: string; active: boolean;
  onSelect: () => void;
}) {
  return (
    <div className={cn('flex items-center w-full rounded-xl text-sm transition-colors', active ? 'bg-muted text-foreground' : 'hover:bg-muted/60 text-foreground')}>
      <button onClick={onSelect} className="flex items-center gap-2 flex-1 min-w-0 text-left px-3 py-2">
        <MessageCircle size={14} className="flex-shrink-0 mt-0.5 text-muted-foreground" />
        <span className="truncate">{title || 'Untitled'}</span>
      </button>
    </div>
  );
}

// Re-exported for LibraryView to display archived rows with unarchive action
export function ArchivedChatRow({ title, active, onSelect, onDelete, onUnarchive }: {
  id: string; title: string; active: boolean;
  onSelect: () => void; onDelete: () => void; onUnarchive: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) onDelete(); else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }
  };

  return (
    <div className={cn('group flex items-center gap-1 w-full rounded-xl text-sm transition-colors', active ? 'bg-muted text-foreground' : 'hover:bg-muted/60 text-foreground')}>
      <button onClick={onSelect} className="flex items-center gap-2 flex-1 min-w-0 text-left px-3 py-2">
        <MessageCircle size={14} className="flex-shrink-0 mt-0.5 text-muted-foreground" />
        <span className="truncate">{title || 'Untitled'}</span>
        <span className="ml-1.5 text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full flex-shrink-0">archived</span>
      </button>
      <button 
        onClick={(e) => { e.stopPropagation(); onUnarchive(); }} 
        className="p-1.5 rounded-md hover:bg-muted hover:text-foreground text-muted-foreground transition-all flex-shrink-0"
        title="Unarchive"
      >
        <ArchiveRestore size={14} />
      </button>
      <button 
        onClick={handleDelete} 
        className={cn(
          'p-1.5 mr-1 rounded-md transition-all flex-shrink-0',
          confirmDelete ? 'opacity-100 bg-destructive/15 text-destructive' : 'hover:bg-destructive/10 hover:text-destructive text-muted-foreground',
        )}
        title={confirmDelete ? 'Tap again to delete' : 'Delete'}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
