import { useMemo, useState } from 'react';
import { Search, X, MessageCircle, CalendarDays } from 'lucide-react';
import { useStore } from '../state/store';
import { ArchivedChatRow } from './Sidebar';
import { cn } from '../lib/utils';

type TimeFilter = 'all' | 'today' | 'week' | 'month' | '3months' | '6months' | 'year' | string; // string = a year like '2025'

function startOf(filter: TimeFilter): Date | null {
  const now = new Date();
  if (filter === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
  if (filter === 'month') { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d; }
  if (filter === '3months') { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d; }
  if (filter === '6months') { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d; }
  if (filter === 'year') { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; }
  if (/^\d{4}$/.test(filter)) return new Date(Number(filter), 0, 1);
  return null; // 'all'
}

function endOf(filter: TimeFilter): Date | null {
  if (/^\d{4}$/.test(filter)) return new Date(Number(filter), 11, 31, 23, 59, 59);
  return null;
}

const BASE_FILTERS: { key: TimeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'Last month' },
  { key: '3months', label: '3 months' },
  { key: '6months', label: '6 months' },
  { key: 'year', label: 'Last year' },
];

export function LibraryView() {
  const conversations = useStore((s) => s.conversations);
  const archivedIds = useStore((s) => s.archivedIds);
  const activeId = useStore((s) => s.activeConversationId);
  const selectConversation = useStore((s) => s.selectConversation);
  const removeConversation = useStore((s) => s.removeConversation);
  const archiveConversation = useStore((s) => s.archiveConversation);
  const unarchiveConversation = useStore((s) => s.unarchiveConversation);
  const setAppView = useStore((s) => s.setAppView);

  const [query, setQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [showArchived, setShowArchived] = useState(false);

  // Derive unique years from conversation dates
  const yearFilters = useMemo(() => {
    const years = new Set<number>();
    for (const c of conversations) years.add(new Date(c.createdAt).getFullYear());
    return [...years].sort((a, b) => b - a).map((y) => ({ key: String(y), label: String(y) }));
  }, [conversations]);

  const filters = [...BASE_FILTERS, ...yearFilters];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const start = startOf(timeFilter);
    const end = endOf(timeFilter);

    return conversations.filter((c) => {
      const isArchived = archivedIds.includes(c.id);
      if (showArchived ? !isArchived : isArchived) return false;
      if (q && !c.title.toLowerCase().includes(q)) return false;
      if (start) {
        const d = new Date(c.createdAt);
        if (d < start) return false;
        if (end && d > end) return false;
      }
      return true;
    });
  }, [conversations, archivedIds, showArchived, query, timeFilter]);

  const handleSelect = (id: string) => {
    void selectConversation(id);
    setAppView('chat');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <CalendarDays size={20} className="text-muted-foreground" />
          Library
        </h1>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setShowArchived(false)}
            className={cn('px-3 py-1.5 rounded-lg transition-colors', !showArchived ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60')}
          >
            Chats
          </button>
          <button
            onClick={() => setShowArchived(true)}
            className={cn('px-3 py-1.5 rounded-lg transition-colors', showArchived ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60')}
          >
            Archived
            {archivedIds.length > 0 && (
              <span className="ml-1.5 text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                {archivedIds.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="px-6 py-3 border-b border-border space-y-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title…"
            className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-9 text-sm outline-none focus:border-primary"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Time filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setTimeFilter(f.key)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors border',
                timeFilter === f.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
        <div className="max-w-3xl mx-auto space-y-1">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              <MessageCircle size={32} className="mx-auto mb-3 opacity-30" />
              {query ? 'No chats match your search.' : showArchived ? 'No archived chats.' : 'No chats in this time range.'}
            </div>
          ) : (
            filtered.map((c) =>
              showArchived ? (
                <ArchivedChatRow
                  key={c.id} id={c.id} title={c.title} active={activeId === c.id}
                  onSelect={() => handleSelect(c.id)}
                  onDelete={() => void removeConversation(c.id)}
                  onUnarchive={() => unarchiveConversation(c.id)}
                />
              ) : (
                <LibraryRow
                  key={c.id} id={c.id} title={c.title} createdAt={c.createdAt} model={c.modelDefault}
                  active={activeId === c.id}
                  onSelect={() => handleSelect(c.id)}
                  onDelete={() => void removeConversation(c.id)}
                  onArchive={() => archiveConversation(c.id)}
                />
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}

function LibraryRow({ title, createdAt, model, active, onSelect, onDelete, onArchive }: {
  id: string; title: string; createdAt: string; model: string; active: boolean;
  onSelect: () => void; onDelete: () => void; onArchive: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) onDelete(); else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-3 w-full rounded-xl p-3 transition-colors cursor-pointer',
        active ? 'bg-muted' : 'hover:bg-muted/60',
      )}
      onClick={onSelect}
    >
      <MessageCircle size={16} className="flex-shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium">{title || 'Untitled'}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {new Date(createdAt).toLocaleString()} · {model}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onArchive(); }}
          className="p-1.5 rounded-md hover:bg-background text-muted-foreground hover:text-foreground transition-colors"
          title="Archive"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
        </button>
        <button
          onClick={handleDelete}
          className={cn('p-1.5 rounded-md transition-colors', confirmDelete ? 'bg-destructive/15 text-destructive' : 'hover:bg-background text-muted-foreground hover:text-destructive')}
          title={confirmDelete ? 'Tap again to delete' : 'Delete'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
  );
}
