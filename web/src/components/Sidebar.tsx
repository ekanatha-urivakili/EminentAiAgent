import { Edit3, MessageCircle, Trash2, PanelLeftClose, Plug, Search, Library, Cpu, Archive, ArchiveRestore, Mail, Briefcase } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../lib/utils';
import { useStore } from '../state/store';
import { BrandLogo } from './BrandLogo';

export function Sidebar({ isOpen, toggle, onNavigate }: { isOpen: boolean; toggle: () => void; onNavigate?: () => void }) {
  const conversations = useStore((s) => s.conversations);
  const archivedIds = useStore((s) => s.archivedIds);
  const activeId = useStore((s) => s.activeConversationId);
  const selectConversation = useStore((s) => s.selectConversation);
  const renameConversation = useStore((s) => s.renameConversation);
  const removeConversation = useStore((s) => s.removeConversation);
  const archiveConversation = useStore((s) => s.archiveConversation);
  const newConversation = useStore((s) => s.newConversation);
  const connectors = useStore((s) => s.connectors);
  const appView = useStore((s) => s.appView);
  const setAppView = useStore((s) => s.setAppView);

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
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 pt-5 space-y-1">
              <div className="px-2 mb-3">
                <div className="text-sm font-semibold">Recents</div>
              </div>

              {recentConversations.map((c) => (
                <ChatRow key={c.id} id={c.id} title={c.title} active={activeId === c.id}
                  onSelect={() => selectAndNavigate(c.id)}
                  onRename={(title) => renameConversation(c.id, title)}
                  onDelete={() => void removeConversation(c.id)}
                  onArchive={() => archiveConversation(c.id)}
                />
              ))}

              {recentConversations.length === 0 && (
                <div className="text-xs text-muted-foreground px-2 py-4 text-center">No conversations yet</div>
              )}
            </div>

            <div className="p-3 border-t border-border text-[11px] text-muted-foreground">
              100% local · zero cloud inference
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center gap-6 pt-12">
            <button onClick={createConversation} title="New chat" className="p-2 hover:bg-muted rounded-lg transition-colors"><Edit3 size={24} /></button>
            <button onClick={() => navigate('library')} title="Library" className={cn('p-2 hover:bg-muted rounded-lg transition-colors', appView === 'library' && 'bg-muted')}><Library size={24} /></button>
            <button onClick={() => navigate('ollama')} title="Ollama" className={cn('p-2 hover:bg-muted rounded-lg transition-colors', appView === 'ollama' && 'bg-muted')}><Cpu size={24} /></button>
            <button onClick={() => navigate('mailpit')} title="Mailpit" className={cn('p-2 hover:bg-muted rounded-lg transition-colors', appView === 'mailpit' && 'bg-muted')}><Mail size={24} /></button>
            <button onClick={() => navigate('connectors')} title="MCP Connectors" className={cn('p-2 hover:bg-muted rounded-lg transition-colors', appView === 'connectors' && 'bg-muted')}><Plug size={22} /></button>
            <button onClick={() => navigate('jobs')} title="Job Search Agent" className={cn('p-2 hover:bg-muted rounded-lg transition-colors mt-auto mb-5', appView === 'jobs' && 'bg-muted')}><Briefcase size={22} /></button>
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

function ChatRow({ title, active, onSelect, onRename, onDelete, onArchive }: {
  id: string; title: string; active: boolean;
  onSelect: () => void; onRename: (title: string) => Promise<void>; onDelete: () => void; onArchive: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title || 'Untitled');
  const [saving, setSaving] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) { onDelete(); } else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }
  };

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftTitle(title || 'Untitled');
    setEditing(true);
  };

  const saveTitle = async () => {
    const nextTitle = draftTitle.trim();
    if (!nextTitle || nextTitle === title) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await onRename(nextTitle);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveTitle();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
      setDraftTitle(title || 'Untitled');
    }
  };

  return (
    <div className={cn('group flex items-center gap-1 w-full rounded-xl text-sm transition-colors', active ? 'bg-muted text-foreground' : 'hover:bg-muted/60 text-foreground')}>
      {editing ? (
        <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2">
          <MessageCircle size={14} className="flex-shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={draftTitle}
            disabled={saving}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={handleEditKeyDown}
            className="min-w-0 flex-1 bg-background border border-border rounded-md px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      ) : (
        <button onClick={onSelect} className="flex items-center gap-2 flex-1 min-w-0 text-left px-3 py-2">
          <MessageCircle size={14} className="flex-shrink-0 mt-0.5 text-muted-foreground" />
          <span className="truncate">{title || 'Untitled'}</span>
        </button>
      )}

      <button
        onClick={startEditing}
        className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground text-muted-foreground transition-all flex-shrink-0"
        title="Rename"
      >
        <Edit3 size={12} />
      </button>

      {/* Archive */}
      <button
        onClick={(e) => { e.stopPropagation(); onArchive(); }}
        className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground text-muted-foreground transition-all flex-shrink-0"
        title="Archive"
      >
        <Archive size={13} />
      </button>

      {/* Delete — tap once to arm, again to confirm */}
      <button
        onClick={handleDelete}
        className={cn(
          'p-1.5 mr-1 rounded-md opacity-0 group-hover:opacity-100 transition-all flex-shrink-0',
          confirmDelete ? 'opacity-100 bg-destructive/15 text-destructive' : 'hover:bg-destructive/10 hover:text-destructive text-muted-foreground',
        )}
        title={confirmDelete ? 'Tap again to delete' : 'Delete'}
      >
        <Trash2 size={13} />
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
    <div className={cn('group flex items-center gap-1 w-full rounded-xl text-base transition-colors', active ? 'bg-muted text-foreground' : 'hover:bg-muted/60 text-foreground')}>
      <button onClick={onSelect} className="flex items-center gap-2 flex-1 min-w-0 text-left px-3 py-2.5">
        <MessageCircle size={16} className="flex-shrink-0 mt-0.5 text-muted-foreground" />
        <span className="truncate">{title || 'Untitled'}</span>
        <span className="ml-1.5 text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full flex-shrink-0">archived</span>
      </button>
      <button onClick={(e) => { e.stopPropagation(); onUnarchive(); }} className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-all flex-shrink-0" title="Unarchive">
        <ArchiveRestore size={13} />
      </button>
      <button onClick={handleDelete} className={cn('p-1.5 mr-1 rounded-md opacity-0 group-hover:opacity-100 transition-all flex-shrink-0', confirmDelete ? 'opacity-100 bg-destructive/15 text-destructive' : 'hover:bg-destructive/10 hover:text-destructive text-muted-foreground')} title={confirmDelete ? 'Tap again to delete' : 'Delete'}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}
