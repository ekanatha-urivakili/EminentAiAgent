import { useEffect, useRef, useState } from 'react';
import {
  Briefcase, RefreshCw, Upload, Trash2, CheckCircle2, XCircle, AlertCircle,
  ChevronDown, ChevronUp, Star, Wifi, WifiOff, FileText, Settings, Activity,
  Plus, X,
} from 'lucide-react';
import { useStore } from '../state/store';
import { cn } from '../lib/utils';
import type { JobSearchCriteria, JobMatchResult, SourceHealthInfo } from '../lib/types';

type Tab = 'results' | 'settings' | 'cvs' | 'sources';

export function JobSearchView() {
  const [tab, setTab] = useState<Tab>('results');
  const jobResults = useStore((s) => s.jobResults);
  const jobLoading = useStore((s) => s.jobLoading);
  const jobError = useStore((s) => s.jobError);
  const jobSettings = useStore((s) => s.jobSettings);
  const jobSources = useStore((s) => s.jobSources);
  const cvFiles = useStore((s) => s.cvFiles);
  const loadJobResults = useStore((s) => s.loadJobResults);
  const runJobSearch = useStore((s) => s.runJobSearch);
  const loadJobSettings = useStore((s) => s.loadJobSettings);
  const saveJobSettings = useStore((s) => s.saveJobSettings);
  const loadJobSources = useStore((s) => s.loadJobSources);
  const loadCvFiles = useStore((s) => s.loadCvFiles);
  const uploadCv = useStore((s) => s.uploadCv);
  const deleteCv = useStore((s) => s.deleteCv);

  useEffect(() => {
    void loadJobResults();
    void loadJobSettings();
    void loadJobSources();
    void loadCvFiles();
  }, [loadJobResults, loadJobSettings, loadJobSources, loadCvFiles]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'results', label: 'Results', icon: <Briefcase size={15} /> },
    { key: 'settings', label: 'Settings', icon: <Settings size={15} /> },
    { key: 'cvs', label: 'CVs', icon: <FileText size={15} /> },
    { key: 'sources', label: 'Sources', icon: <Activity size={15} /> },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 pt-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Briefcase size={20} /> Job Search Agent
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Automated job discovery, filtering, and CV scoring
            </p>
          </div>
          {tab === 'results' && (
            <button
              onClick={() => void runJobSearch()}
              disabled={jobLoading}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors text-sm font-medium"
            >
              <RefreshCw size={15} className={cn(jobLoading && 'animate-spin')} />
              {jobLoading ? 'Searching…' : 'Run Search'}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm rounded-t-lg border-b-2 transition-colors',
                tab === t.key
                  ? 'border-primary text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.icon} {t.label}
              {t.key === 'results' && jobResults && (
                <span className="ml-1 text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                  {jobResults.matches.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {tab === 'results' && (
          <ResultsTab results={jobResults} loading={jobLoading} error={jobError} />
        )}
        {tab === 'settings' && (
          <SettingsTab settings={jobSettings} onSave={saveJobSettings} />
        )}
        {tab === 'cvs' && (
          <CvsTab files={cvFiles} onUpload={uploadCv} onDelete={deleteCv} onReload={loadCvFiles} />
        )}
        {tab === 'sources' && (
          <SourcesTab sources={jobSources} onRefresh={loadJobSources} />
        )}
      </div>
    </div>
  );
}

// ── Results Tab ───────────────────────────────────────────────────────────────

function ResultsTab({
  results,
  loading,
  error,
}: {
  results: import('../lib/types').JobSearchRunResult | undefined;
  loading: boolean;
  error?: string;
}) {
  if (loading && !results) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <RefreshCw size={32} className="animate-spin" />
        <span>Searching across sources…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
        <AlertCircle size={18} />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
        <Briefcase size={48} className="opacity-20" />
        <div className="text-center">
          <p className="font-medium">No results yet</p>
          <p className="text-sm mt-1">Configure your settings and click Run Search to start</p>
        </div>
      </div>
    );
  }

  const recommended = results.matches.filter((m) => m.recommended);
  const rest = results.matches.filter((m) => !m.recommended);

  return (
    <div className="space-y-6">
      {/* Run summary */}
      <div className="flex flex-wrap gap-4">
        <StatPill
          label="Total matches"
          value={results.matches.length}
          color="default"
        />
        <StatPill label="Recommended" value={recommended.length} color="green" />
        <StatPill
          label="Rejected"
          value={(Object.values(results.rejectedSummary) as number[]).reduce((a, b) => a + b, 0)}
          color="muted"
        />
        {results.finishedAt && (
          <span className="text-xs text-muted-foreground self-center">
            Run at {new Date(results.startedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Source statuses */}
      <div className="flex flex-wrap gap-2">
        {results.sourceStatuses.map((s) => (
          <span
            key={s.source}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
              s.status === 'Succeeded'
                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                : s.status === 'Failed'
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {s.status === 'Succeeded' ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
            {s.source}: {s.jobsFetched} jobs
          </span>
        ))}
      </div>

      {/* Rejected summary */}
      {Object.keys(results.rejectedSummary).length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
            Rejected jobs breakdown
          </summary>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
            {(Object.entries(results.rejectedSummary) as [string, number][])
              .sort(([, a], [, b]) => b - a)
              .map(([reason, count]) => (
                <div key={reason} className="flex justify-between text-xs bg-muted/50 rounded-lg px-3 py-1.5">
                  <span className="text-muted-foreground">{reason}</span>
                  <span className="font-mono font-medium">{count}</span>
                </div>
              ))}
          </div>
        </details>
      )}

      {/* Recommended section */}
      {recommended.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Star size={13} className="text-amber-500" /> Recommended ({recommended.length})
          </h3>
          <div className="space-y-3">
            {recommended.map((m) => <JobCard key={m.posting.id} match={m} />)}
          </div>
        </section>
      )}

      {/* Other matches */}
      {rest.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Other matches ({rest.length})
          </h3>
          <div className="space-y-3">
            {rest.map((m) => <JobCard key={m.posting.id} match={m} />)}
          </div>
        </section>
      )}

      {results.matches.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="font-medium">No matching jobs found</p>
          <p className="text-sm mt-1">Try adjusting your search criteria or check source status</p>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: 'default' | 'green' | 'muted' }) {
  return (
    <div className={cn(
      'px-4 py-2 rounded-xl border text-center min-w-[80px]',
      color === 'green' ? 'border-green-500/30 bg-green-500/5' :
      color === 'muted' ? 'border-border bg-muted/30' :
      'border-border bg-muted/50',
    )}>
      <div className={cn(
        'text-2xl font-bold',
        color === 'green' ? 'text-green-600 dark:text-green-400' : 'text-foreground',
      )}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function JobCard({ match }: { match: JobMatchResult }) {
  const [expanded, setExpanded] = useState(false);
  const { posting, score, recommended, reasons, risks } = match;

  const scoreColor =
    score >= 75 ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' :
    score >= 50 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' :
    'bg-muted text-muted-foreground border-border';

  return (
    <div className={cn(
      'border rounded-xl transition-all',
      recommended ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-card',
    )}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {recommended && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                  <Star size={10} /> Recommended
                </span>
              )}
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {posting.source}
              </span>
            </div>
            <h3 className="font-semibold mt-1 text-base leading-tight">
              {posting.url ? (
                <a
                  href={posting.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary transition-colors"
                >
                  {posting.title}
                </a>
              ) : posting.title}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {posting.company} · {posting.location}
            </p>
          </div>

          <div className={cn('flex-shrink-0 border px-3 py-1.5 rounded-lg text-center min-w-[56px]', scoreColor)}>
            <div className="text-lg font-bold leading-none">{score}</div>
            <div className="text-[10px] mt-0.5">score</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-3 text-xs">
          {posting.employmentType && (
            <span className="bg-muted px-2 py-1 rounded-md">{posting.employmentType}</span>
          )}
          {posting.workMode && (
            <span className="bg-muted px-2 py-1 rounded-md">{posting.workMode}</span>
          )}
          {(posting.salaryMin != null || posting.salaryMax != null) && (
            <span className="bg-muted px-2 py-1 rounded-md font-mono">
              £{(posting.salaryMin ?? 0).toLocaleString()}
              {posting.salaryMax && posting.salaryMax !== posting.salaryMin
                ? `–£${posting.salaryMax.toLocaleString()}`
                : ''}
            </span>
          )}
          {(posting.dayRateMin != null || posting.dayRateMax != null) && (
            <span className="bg-muted px-2 py-1 rounded-md font-mono">
              £{(posting.dayRateMin ?? 0).toLocaleString()}/day
              {posting.dayRateMax && posting.dayRateMax !== posting.dayRateMin
                ? `–£${posting.dayRateMax.toLocaleString()}`
                : ''}
            </span>
          )}
          {posting.postedDate && (
            <span className="text-muted-foreground px-2 py-1">
              {new Date(posting.postedDate).toLocaleDateString()}
            </span>
          )}
        </div>

        {(reasons.length > 0 || risks.length > 0) && (
          <div className="flex flex-wrap gap-2 mt-2">
            {reasons.map((r) => (
              <span key={r} className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <CheckCircle2 size={11} /> {r}
              </span>
            ))}
            {risks.map((r) => (
              <span key={r} className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle size={11} /> {r}
              </span>
            ))}
          </div>
        )}

        {posting.description && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-3 transition-colors"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? 'Hide' : 'Show'} description
          </button>
        )}

        {expanded && posting.description && (
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed whitespace-pre-line line-clamp-10">
            {posting.description}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

function SettingsTab({
  settings,
  onSave,
}: {
  settings: JobSearchCriteria;
  onSave: (s: JobSearchCriteria) => Promise<void>;
}) {
  const [form, setForm] = useState<JobSearchCriteria>(settings);
  const [newKeyword, setNewKeyword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync store settings into local form state when they load from the API.
  // Deferred to avoid the "setState in effect body" lint warning while still
  // capturing the async load that happens after mount.
  useEffect(() => {
    const id = setTimeout(() => setForm(settings), 0);
    return () => clearTimeout(id);
  }, [settings]);

  const addKeyword = () => {
    const kw = newKeyword.trim();
    if (!kw || form.keywords.includes(kw)) return;
    setForm((f) => ({ ...f, keywords: [...f.keywords, kw] }));
    setNewKeyword('');
  };

  const removeKeyword = (kw: string) =>
    setForm((f) => ({ ...f, keywords: f.keywords.filter((k) => k !== kw) }));

  const toggleEmpType = (t: string) =>
    setForm((f) => ({
      ...f,
      employmentTypes: f.employmentTypes.includes(t)
        ? f.employmentTypes.filter((e) => e !== t)
        : [...f.employmentTypes, t],
    }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* Keywords */}
      <section>
        <label className="block text-sm font-semibold mb-2">Job Title Keywords</label>
        <div className="flex gap-2 mb-2">
          <input
            className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="e.g. Senior Software Engineer"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
          />
          <button
            onClick={addKeyword}
            className="px-3 py-2 bg-muted border border-border rounded-lg hover:bg-muted/80 transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {form.keywords.map((kw) => (
            <span
              key={kw}
              className="inline-flex items-center gap-1 bg-primary/10 text-primary px-3 py-1 rounded-full text-sm"
            >
              {kw}
              <button onClick={() => removeKeyword(kw)} className="hover:text-destructive ml-1 transition-colors">
                <X size={12} />
              </button>
            </span>
          ))}
          {form.keywords.length === 0 && (
            <span className="text-sm text-muted-foreground">No keywords — all titles will be included</span>
          )}
        </div>
      </section>

      {/* Location */}
      <section className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-2">Postcode / Location</label>
          <input
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="e.g. SW1A 1AA"
            value={form.postcode}
            onChange={(e) => setForm((f) => ({ ...f, postcode: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-2">Radius (miles)</label>
          <input
            type="number"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={form.radiusMiles}
            min={1}
            max={200}
            onChange={(e) => setForm((f) => ({ ...f, radiusMiles: Number(e.target.value) }))}
          />
        </div>
      </section>

      {/* Posted within */}
      <section>
        <label className="block text-sm font-semibold mb-2">
          Posted within (days): <span className="text-primary font-mono">{form.postedWithinDays}</span>
        </label>
        <input
          type="range"
          min={1}
          max={60}
          value={form.postedWithinDays}
          className="w-full accent-primary"
          onChange={(e) => setForm((f) => ({ ...f, postedWithinDays: Number(e.target.value) }))}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>1 day</span><span>30 days</span><span>60 days</span>
        </div>
      </section>

      {/* Employment types */}
      <section>
        <label className="block text-sm font-semibold mb-2">Employment Types</label>
        <div className="flex gap-3">
          {['Permanent', 'Contract', 'Part-time'].map((t) => (
            <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                className="accent-primary w-4 h-4"
                checked={form.employmentTypes.includes(t)}
                onChange={() => toggleEmpType(t)}
              />
              {t}
            </label>
          ))}
        </div>
      </section>

      {/* Salary thresholds */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-2">Min Salary (£/yr)</label>
          <input
            type="number"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="0"
            value={form.minimumPermanentSalaryGbp || ''}
            min={0}
            step={5000}
            onChange={(e) => setForm((f) => ({ ...f, minimumPermanentSalaryGbp: Number(e.target.value) }))}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-2">Min Day Rate (£)</label>
          <input
            type="number"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="0"
            value={form.minimumContractDayRateGbp || ''}
            min={0}
            step={50}
            onChange={(e) => setForm((f) => ({ ...f, minimumContractDayRateGbp: Number(e.target.value) }))}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-2">Min Contract (months)</label>
          <input
            type="number"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="0"
            value={form.minimumContractMonths || ''}
            min={0}
            onChange={(e) => setForm((f) => ({ ...f, minimumContractMonths: Number(e.target.value) }))}
          />
        </div>
      </section>

      <button
        onClick={() => void handleSave()}
        disabled={saving}
        className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors text-sm font-medium"
      >
        {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  );
}

// ── CVs Tab ───────────────────────────────────────────────────────────────────

function CvsTab({
  files,
  onUpload,
  onDelete,
  onReload,
}: {
  files: string[];
  onUpload: (f: File) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError(undefined);
    try {
      await onUpload(file);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  };

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-sm font-semibold mb-1">Upload CVs for Better Matching</h2>
        <p className="text-xs text-muted-foreground">
          .pdf, .docx, .txt and .md files. Keywords are extracted for scoring.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => void handleDrop(e)}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
        )}
      >
        <Upload size={28} className="text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium">
            {uploading ? 'Uploading…' : 'Drop a file here or click to browse'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, TXT, MD</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.txt,.md"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {uploadError && (
        <div className="text-sm text-destructive flex items-center gap-2">
          <XCircle size={14} /> {uploadError}
        </div>
      )}

      {/* File list */}
      {files.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Uploaded CVs ({files.length})</h3>
            <button
              onClick={() => void onReload()}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Refresh
            </button>
          </div>
          {files.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between bg-muted/50 border border-border rounded-lg px-4 py-2.5"
            >
              <div className="flex items-center gap-2 text-sm">
                <FileText size={15} className="text-muted-foreground" />
                <span className="font-mono">{name}</span>
              </div>
              <button
                onClick={() => void onDelete(name)}
                className="p-1.5 hover:bg-destructive/10 hover:text-destructive text-muted-foreground rounded-md transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No CVs uploaded yet. Add a CV to improve match scoring.
        </p>
      )}
    </div>
  );
}

// ── Sources Tab ───────────────────────────────────────────────────────────────

function SourcesTab({
  sources,
  onRefresh,
}: {
  sources: SourceHealthInfo[];
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="space-y-4 max-w-lg">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Source Health</h2>
        <button
          onClick={() => void onRefresh()}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading sources…</p>
      ) : (
        sources.map((s) => <SourceCard key={s.source} source={s} />)
      )}

      <div className="p-4 bg-muted/30 border border-border rounded-xl text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">How to activate sources</p>
        <p>
          <strong>Reed API:</strong> Set the <code className="bg-muted px-1 rounded">REED_API_KEY</code> environment
          variable before starting the server. Get a free key at{' '}
          <span className="font-mono">reed.co.uk/developers/jobseeker</span>.
        </p>
        <p>
          <strong>Indeed Direct:</strong> POST normalized job data to{' '}
          <code className="bg-muted px-1 rounded">POST /api/jobs/ingest_indeed</code> using an MCP client or any
          HTTP caller. The buffer is in-memory and resets on server restart.
        </p>
      </div>
    </div>
  );
}

function SourceCard({ source }: { source: SourceHealthInfo }) {
  return (
    <div className={cn(
      'border rounded-xl p-4 space-y-2',
      source.ready ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-card',
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {source.ready
            ? <Wifi size={16} className="text-green-500" />
            : <WifiOff size={16} className="text-muted-foreground" />}
          <span className="font-semibold">{source.source}</span>
        </div>
        <span className={cn(
          'text-xs px-2 py-0.5 rounded-full font-medium',
          source.ready
            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
            : 'bg-muted text-muted-foreground',
        )}>
          {source.ready ? 'Ready' : 'Not Ready'}
        </span>
      </div>

      <div className="text-xs text-muted-foreground space-y-0.5">
        <p><span className="font-medium text-foreground">Mode:</span> {source.mode}</p>
        {source.bufferedJobs > 0 && (
          <p><span className="font-medium text-foreground">Buffered:</span> {source.bufferedJobs} jobs</p>
        )}
        {source.requiredSecret && !source.ready && (
          <p className="text-amber-600 dark:text-amber-400">
            <AlertCircle size={11} className="inline mr-1" />
            {source.requiredSecret}
          </p>
        )}
        {source.lastError && (
          <p className="text-destructive">
            <XCircle size={11} className="inline mr-1" />
            {source.lastError}
          </p>
        )}
      </div>
    </div>
  );
}
