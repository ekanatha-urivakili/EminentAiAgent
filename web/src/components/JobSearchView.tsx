import { useEffect, useRef, useState } from 'react';
import {
  Briefcase, RefreshCw, Upload, Trash2, CheckCircle2, XCircle, AlertCircle,
  ChevronDown, ChevronUp, Star, Wifi, WifiOff, FileText, Settings, Activity,
  Plus, X, HelpCircle, Copy, PlayCircle,
} from 'lucide-react';
import { useStore } from '../state/store';
import { cn } from '../lib/utils';
import type { IndeedJobInput, JobSearchCriteria, JobMatchResult, SourceHealthInfo } from '../lib/types';

type Tab = 'results' | 'settings' | 'cvs' | 'sources';

const indeedExamplePayload = '[{"jobkey":"abc123","jobTitle":"Senior Software Engineer","companyName":"Example Ltd","formattedLocation":"Remote","jobUrl":"https://uk.indeed.com/viewjob?jk=abc123"}]';
const indeedCurlCommand = `curl -X POST http://127.0.0.1:5210/api/jobs/ingest_indeed \\
  -H "Content-Type: application/json" \\
  -d '{"clearFirst":true,"jobs":${indeedExamplePayload}}'`;
const reedSetupCommand = 'export REED_API_KEY="your_reed_api_key"';
const gmailSetupCommand = 'Set GMAIL_CREDENTIALS_JSON and GMAIL_USER_EMAIL in Source Configuration, then Save Settings.';

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

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
  const ingestIndeedJobs = useStore((s) => s.ingestIndeedJobs);

  useEffect(() => {
    void loadJobResults();
    void loadJobSettings();
    void loadJobSources();
    void loadCvFiles();
  }, [loadJobResults, loadJobSettings, loadJobSources, loadCvFiles]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'results', label: 'Results', icon: <Briefcase size={16} /> },
    { key: 'settings', label: 'Settings', icon: <Settings size={16} /> },
    { key: 'cvs', label: 'CVs', icon: <FileText size={16} /> },
    { key: 'sources', label: 'Sources', icon: <Activity size={16} /> },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 pt-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Briefcase size={22} /> Job Search Agent
            </h1>
            <p className="text-base text-muted-foreground mt-0.5">
              Automated job discovery, filtering, and CV scoring
            </p>
          </div>
          {tab === 'results' && (
            <button
              onClick={() => void runJobSearch()}
              disabled={jobLoading}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors text-base font-medium"
            >
              <RefreshCw size={16} className={cn(jobLoading && 'animate-spin')} />
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
                'flex items-center gap-1.5 px-4 py-2.5 text-base rounded-t-lg border-b-2 transition-colors',
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
          <SourcesTab
            sources={jobSources}
            onRefresh={loadJobSources}
            onIngestIndeed={ingestIndeedJobs}
            settings={jobSettings}
            onSave={saveJobSettings}
          />
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
        <RefreshCw size={36} className="animate-spin" />
        <span className="text-base">Searching across sources…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
        <AlertCircle size={20} />
        <span className="text-base">{error}</span>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
        <Briefcase size={56} className="opacity-20" />
        <div className="text-center">
          <p className="font-medium text-lg">No results yet</p>
          <p className="text-base mt-1">Configure your settings and click Run Search to start</p>
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
          <span className="text-sm text-muted-foreground self-center">
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
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium',
              s.status === 'Succeeded'
                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                : s.status === 'Failed'
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {s.status === 'Succeeded' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {s.source}: {s.jobsFetched} jobs
          </span>
        ))}
      </div>

      {/* Rejected summary */}
      {Object.keys(results.rejectedSummary).length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-base text-muted-foreground hover:text-foreground transition-colors">
            Rejected jobs breakdown
          </summary>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
            {(Object.entries(results.rejectedSummary) as [string, number][])
              .sort(([, a], [, b]) => b - a)
              .map(([reason, count]) => (
                <div key={reason} className="flex justify-between text-sm bg-muted/50 rounded-lg px-3 py-1.5">
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
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Star size={14} className="text-amber-500" /> Recommended ({recommended.length})
          </h3>
          <div className="space-y-3">
            {recommended.map((m) => <JobCard key={m.posting.id} match={m} />)}
          </div>
        </section>
      )}

      {/* Other matches */}
      {rest.length > 0 && (
        <section>
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-3">
            Other matches ({rest.length})
          </h3>
          <div className="space-y-3">
            {rest.map((m) => <JobCard key={m.posting.id} match={m} />)}
          </div>
        </section>
      )}

      {results.matches.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="font-medium text-lg">No matching jobs found</p>
          <p className="text-base mt-1">Try adjusting your search criteria or check source status</p>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: 'default' | 'green' | 'muted' }) {
  return (
    <div className={cn(
      'px-5 py-3 rounded-xl border text-center min-w-[100px]',
      color === 'green' ? 'border-green-500/30 bg-green-500/5' :
      color === 'muted' ? 'border-border bg-muted/30' :
      'border-border bg-muted/50',
    )}>
      <div className={cn(
        'text-3xl font-bold',
        color === 'green' ? 'text-green-600 dark:text-green-400' : 'text-foreground',
      )}>{value}</div>
      <div className="text-xs text-muted-foreground uppercase font-semibold tracking-wide">{label}</div>
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
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {recommended && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full uppercase tracking-tight">
                  <Star size={11} /> Recommended
                </span>
              )}
              <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full uppercase tracking-tight">
                {posting.source}
              </span>
            </div>
            <h3 className="font-semibold mt-1 text-lg leading-tight">
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
            <p className="text-base text-muted-foreground mt-0.5">
              {posting.company} · {posting.location}
            </p>
          </div>

          <div className={cn('flex-shrink-0 border px-3 py-1.5 rounded-lg text-center min-w-[64px]', scoreColor)}>
            <div className="text-xl font-bold leading-none">{score}</div>
            <div className="text-[10px] uppercase font-bold mt-1">score</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4 text-sm">
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
          <div className="flex flex-wrap gap-2 mt-3">
            {reasons.map((r) => (
              <span key={r} className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 size={13} /> {r}
              </span>
            ))}
            {risks.map((r) => (
              <span key={r} className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400">
                <AlertCircle size={13} /> {r}
              </span>
            ))}
          </div>
        )}

        {posting.description && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mt-4 transition-colors font-medium"
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            {expanded ? 'Hide' : 'Show'} description
          </button>
        )}

        {expanded && posting.description && (
          <p className="mt-3 text-base text-muted-foreground leading-relaxed whitespace-pre-line line-clamp-10">
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
  const [scriptMessage, setScriptMessage] = useState<string>();
  const jobLoading = useStore((s) => s.jobLoading);
  const runIndeedIngestScript = useStore((s) => s.runIndeedIngestScript);
  const runIndeedPullScript = useStore((s) => s.runIndeedPullScript);

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

  const toggleWorkMode = (mode: string) =>
    setForm((f) => ({
      ...f,
      workModes: f.workModes.includes(mode)
        ? f.workModes.filter((m) => m !== mode)
        : [...f.workModes, mode],
    }));

  const updateCsv = (key: 'desiredDesignations' | 'skills' | 'excludedKeywords', value: string) =>
    setForm((f) => ({
      ...f,
      [key]: value.split(',').map((item) => item.trim()).filter(Boolean),
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

  const runIndeedScript = async (kind: 'ingest' | 'pull') => {
    setScriptMessage(undefined);
    setSaving(true);
    try {
      await onSave(form);
      setSaving(false);
      if (kind === 'ingest') {
        await runIndeedIngestScript();
        setScriptMessage('Ingest Indeed script finished.');
      } else {
        await runIndeedPullScript();
        setScriptMessage('Indeed Pull Jobs script finished.');
      }
    } catch (err) {
      setScriptMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6 pb-12">
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold mb-5">Job Profile</h2>
        <div className="grid grid-cols-1 gap-5">
          <div>
            <label className="block text-base font-semibold mb-2">Desired Designations</label>
            <textarea
              rows={3}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Senior Software Engineer, Lead Developer, Principal Engineer"
              value={form.desiredDesignations.join(', ')}
              onChange={(e) => updateCsv('desiredDesignations', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-base font-semibold mb-2">Skills</label>
            <textarea
              rows={3}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="C#, ASP.NET Core, React, TypeScript, AWS, Docker"
              value={form.skills.join(', ')}
              onChange={(e) => updateCsv('skills', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-base font-semibold mb-2">Excluded Keywords</label>
            <textarea
              rows={2}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="graduate, junior, java only, onsite 5 days"
              value={form.excludedKeywords.join(', ')}
              onChange={(e) => updateCsv('excludedKeywords', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 space-y-5">
        <h2 className="text-lg font-semibold">Schedule</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-base font-semibold mb-2">Time Zone</label>
            <input
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
              value={form.timeZone}
              onChange={(e) => setForm((f) => ({ ...f, timeZone: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-base font-semibold mb-2">Run At</label>
            <input
              type="time"
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
              value={form.runAt}
              onChange={(e) => setForm((f) => ({ ...f, runAt: e.target.value }))}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Indeed Automation Scripts</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Ready to use: these paths are pre-populated. The buttons save the current paths, then execute the selected script on this machine.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-base font-semibold">Indeed Ingest Script</label>
              <HelpPopover
                title="Ingest Indeed"
                body="Runs the configured ingest script. Use this when your script pushes Indeed jobs into POST /api/jobs/ingest_indeed."
                copyText={form.indeedIngestScript ?? ''}
              />
            </div>
            <input
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
              placeholder="/path/to/ingest_indeed.sh"
              value={form.indeedIngestScript ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, indeedIngestScript: e.target.value }))}
            />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-base font-semibold">Indeed Pull Script</label>
              <HelpPopover
                title="Indeed Pull Jobs"
                body="Runs the configured pull script. Use this when your script fetches/scrapes Indeed jobs before ingesting them."
                copyText={form.indeedPullScript ?? ''}
              />
            </div>
            <input
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
              placeholder="/path/to/ingest_jobs.sh"
              value={form.indeedPullScript ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, indeedPullScript: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void runIndeedScript('ingest')}
            disabled={saving || jobLoading || !form.indeedIngestScript?.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-base font-medium"
          >
            <Upload size={17} />
            Ingest Indeed
          </button>
          <button
            onClick={() => void runIndeedScript('pull')}
            disabled={saving || jobLoading || !form.indeedPullScript?.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors text-base font-medium"
          >
            <RefreshCw size={17} className={cn(jobLoading && 'animate-spin')} />
            Indeed Pull Jobs
          </button>
          {scriptMessage && <span className="text-sm text-muted-foreground font-medium">{scriptMessage}</span>}
        </div>
      </section>

      {/* Keywords */}
      <section className="p-1">
        <label className="block text-base font-semibold mb-2">Job Title Keywords</label>
        <div className="flex gap-2 mb-3">
          <input
            className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="e.g. Senior Software Engineer"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
          />
          <button
            onClick={addKeyword}
            className="px-3 py-2 bg-muted border border-border rounded-lg hover:bg-muted/80 transition-colors"
          >
            <Plus size={18} />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {form.keywords.map((kw) => (
            <span
              key={kw}
              className="inline-flex items-center gap-1 bg-primary/10 text-primary px-3 py-1.5 rounded-full text-base font-medium"
            >
              {kw}
              <button onClick={() => removeKeyword(kw)} className="hover:text-destructive ml-1 transition-colors">
                <X size={14} />
              </button>
            </span>
          ))}
          {form.keywords.length === 0 && (
            <span className="text-base text-muted-foreground">No keywords — all titles will be included</span>
          )}
        </div>
      </section>

      {/* Location */}
      <section className="grid grid-cols-2 gap-5 p-1">
        <div>
          <label className="block text-base font-semibold mb-2">Postcode / Location</label>
          <input
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="e.g. SW1A 1AA"
            value={form.postcode}
            onChange={(e) => setForm((f) => ({ ...f, postcode: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-base font-semibold mb-2">Radius (miles)</label>
          <input
            type="number"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={form.radiusMiles}
            min={1}
            max={200}
            onChange={(e) => setForm((f) => ({ ...f, radiusMiles: Number(e.target.value) }))}
          />
        </div>
      </section>

      {/* Posted within */}
      <section className="p-1">
        <label className="block text-base font-semibold mb-2">
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
        <div className="flex justify-between text-sm text-muted-foreground mt-1">
          <span>1 day</span><span>30 days</span><span>60 days</span>
        </div>
      </section>

      {/* Employment types */}
      <section className="p-1">
        <label className="block text-base font-semibold mb-2">Employment Types</label>
        <div className="flex gap-4">
          {['Permanent', 'Contract', 'Part-time'].map((t) => (
            <label key={t} className="flex items-center gap-2 cursor-pointer text-base">
              <input
                type="checkbox"
                className="accent-primary w-5 h-5"
                checked={form.employmentTypes.includes(t)}
                onChange={() => toggleEmpType(t)}
              />
              {t}
            </label>
          ))}
        </div>
      </section>

      <section className="p-1">
        <label className="block text-base font-semibold mb-2">Work Modes</label>
        <div className="flex gap-4">
          {['Remote', 'Hybrid', 'Office'].map((mode) => (
            <label key={mode} className="flex items-center gap-2 cursor-pointer text-base">
              <input
                type="checkbox"
                className="accent-primary w-5 h-5"
                checked={form.workModes.includes(mode)}
                onChange={() => toggleWorkMode(mode)}
              />
              {mode}
            </label>
          ))}
        </div>
      </section>

      {/* Salary thresholds */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-5 p-1">
        <div>
          <label className="block text-base font-semibold mb-2">Min Salary (£/yr)</label>
          <input
            type="number"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="0"
            value={form.minimumPermanentSalaryGbp || ''}
            min={0}
            step={5000}
            onChange={(e) => setForm((f) => ({ ...f, minimumPermanentSalaryGbp: Number(e.target.value) }))}
          />
        </div>
        <div>
          <label className="block text-base font-semibold mb-2">Min Day Rate (£)</label>
          <input
            type="number"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="0"
            value={form.minimumContractDayRateGbp || ''}
            min={0}
            step={50}
            onChange={(e) => setForm((f) => ({ ...f, minimumContractDayRateGbp: Number(e.target.value) }))}
          />
        </div>
        <div>
          <label className="block text-base font-semibold mb-2">Min Contract (months)</label>
          <input
            type="number"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
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
        className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors text-base font-medium"
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
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Upload CVs for Better Matching</h2>
        <p className="text-base text-muted-foreground">
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
          'border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
        )}
      >
        <Upload size={32} className="text-muted-foreground" />
        <div className="text-center">
          <p className="text-base font-medium">
            {uploading ? 'Uploading…' : 'Drop a file here or click to browse'}
          </p>
          <p className="text-sm text-muted-foreground mt-1 font-medium">PDF, DOCX, TXT, MD</p>
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
        <div className="text-base text-destructive flex items-center gap-2">
          <XCircle size={16} /> {uploadError}
        </div>
      )}

      {/* File list */}
      {files.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Uploaded CVs ({files.length})</h3>
            <button
              onClick={() => void onReload()}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
            >
              Refresh
            </button>
          </div>
          {files.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between bg-muted/50 border border-border rounded-lg px-4 py-3"
            >
              <div className="flex items-center gap-2 text-base">
                <FileText size={18} className="text-muted-foreground" />
                <span className="font-mono">{name}</span>
              </div>
              <button
                onClick={() => void onDelete(name)}
                className="p-1.5 hover:bg-destructive/10 hover:text-destructive text-muted-foreground rounded-md transition-colors"
                title="Delete"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-base text-muted-foreground font-medium">
          No CVs uploaded yet. Add a CV to improve match scoring.
        </p>
      )}
    </div>
  );
}

// ── Sources Tab ───────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function getNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

type SourceName = 'Reed' | 'Indeed Direct' | 'Gmail Alerts';

const sourceHelp: Record<SourceName, { title: string; body: string; command: string }> = {
  Reed: {
    title: 'Reed API',
    body: 'Ready when REED_API_KEY is saved in settings or available as an environment variable before the API server starts.',
    command: reedSetupCommand,
  },
  'Indeed Direct': {
    title: 'Indeed Direct',
    body: 'Ready when at least one Indeed job has been imported into the in-memory buffer. Use the import box below to run the ingest endpoint from this screen.',
    command: indeedCurlCommand,
  },
  'Gmail Alerts': {
    title: 'Gmail Alerts',
    body: 'Ready when Gmail credentials JSON and Gmail user email are saved. The current backend reports configured credentials, but the Gmail fetch adapter still needs implementation before alerts can be searched.',
    command: gmailSetupCommand,
  },
};

function isSourceName(source: string): source is SourceName {
  return source === 'Reed' || source === 'Indeed Direct' || source === 'Gmail Alerts';
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await copyText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex items-center gap-1.5 px-2 py-1 border border-border rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      title={label}
    >
      <Copy size={12} />
      {copied ? 'Copied' : label}
    </button>
  );
}

function HelpPopover({
  title,
  body,
  copyText: copyValue,
}: {
  title: string;
  body: string;
  copyText: string;
}) {
  return (
    <details className="relative group">
      <summary className="list-none cursor-pointer inline-flex items-center text-muted-foreground hover:text-foreground">
        <HelpCircle size={15} />
      </summary>
      <div className="absolute z-20 mt-2 w-72 rounded-xl border border-border bg-popover p-3 shadow-lg text-sm text-popover-foreground space-y-3">
        <div>
          <p className="font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-muted-foreground">{body}</p>
        </div>
        <div className="flex justify-end">
          <CopyButton value={copyValue} />
        </div>
      </div>
    </details>
  );
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        <CopyButton value={command} />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap text-xs font-mono text-foreground">{command}</pre>
    </div>
  );
}

function SourceSetupHelp({ sourceName }: { sourceName: SourceName }) {
  const help = sourceHelp[sourceName];

  return (
    <div className="rounded-lg border border-border bg-card/70 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">{help.title}</p>
          <p className="mt-1">{help.body}</p>
        </div>
        <HelpPopover title={`${help.title} help`} body={help.body} copyText={help.command} />
      </div>
      <CommandBlock label="Copy setup" command={help.command} />
    </div>
  );
}

function parseIndeedPayload(raw: string): IndeedJobInput[] {
  const parsed = JSON.parse(raw) as unknown;
  const root = asRecord(parsed);
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root?.jobs)
      ? root.jobs
      : Array.isArray(root?.results)
        ? root.results
        : [];

  return items
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .map((record) => ({
      jobId: getString(record, ['jobId', 'jobkey', 'jk', 'id']) ?? '',
      jobkey: getString(record, ['jobkey']),
      jk: getString(record, ['jk']),
      title: getString(record, ['title', 'jobTitle']) ?? '',
      jobTitle: getString(record, ['jobTitle']),
      company: getString(record, ['company', 'companyName']) ?? '',
      companyName: getString(record, ['companyName']),
      location: getString(record, ['location', 'formattedLocation']) ?? 'Remote',
      formattedLocation: getString(record, ['formattedLocation']),
      url: getString(record, ['url', 'jobUrl', 'link']),
      jobUrl: getString(record, ['jobUrl']),
      employmentType: getString(record, ['employmentType']),
      workMode: getString(record, ['workMode']),
      salaryMin: getNumber(record, ['salaryMin', 'minimumSalary']),
      salaryMax: getNumber(record, ['salaryMax', 'maximumSalary']),
      dayRateMin: getNumber(record, ['dayRateMin']),
      dayRateMax: getNumber(record, ['dayRateMax']),
      contractMonths: getNumber(record, ['contractMonths']),
      description: getString(record, ['description', 'jobDescription', 'snippet']),
      jobDescription: getString(record, ['jobDescription']),
      snippet: getString(record, ['snippet']),
    }))
    .filter((job) => (job.jobId || job.jobkey || job.jk) && job.title && job.company);
}

function SourcesTab({
  sources,
  onRefresh,
  onIngestIndeed,
  settings,
  onSave,
}: {
  sources: SourceHealthInfo[];
  onRefresh: () => Promise<void>;
  onIngestIndeed: (jobs: IndeedJobInput[], clearFirst?: boolean) => Promise<void>;
  settings: JobSearchCriteria;
  onSave: (s: JobSearchCriteria) => Promise<void>;
}) {
  const [indeedJson, setIndeedJson] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestMessage, setIngestMessage] = useState<string>();
  const [showActivateHelp, setShowActivateHelp] = useState(false);

  const [form, setForm] = useState<JobSearchCriteria>(settings);
  const configuredSecrets = new Set(form.configuredSecretKeys);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

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

  const ingestIndeed = async () => {
    setIngestMessage(undefined);
    const jobs = parseIndeedPayload(indeedJson);
    if (jobs.length === 0) {
      setIngestMessage('No valid Indeed jobs found in the JSON payload.');
      return;
    }

    setIngesting(true);
    try {
      await onIngestIndeed(jobs, true);
      await onRefresh();
      setIngestMessage(`Imported ${jobs.length} Indeed jobs.`);
      setIndeedJson('');
    } catch (err) {
      setIngestMessage((err as Error).message);
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="bg-muted/30 border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowActivateHelp((v) => !v)}
          className="w-full flex items-center justify-between p-5 text-left hover:bg-muted/40 transition-colors"
        >
          <p className="font-semibold text-foreground text-base">How to activate sources</p>
          {showActivateHelp ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>

        {showActivateHelp && (
          <div className="p-5 pt-0 text-sm text-muted-foreground space-y-4">
            <SourceSetupHelp sourceName="Reed" />
            <SourceSetupHelp sourceName="Indeed Direct" />
            <SourceSetupHelp sourceName="Gmail Alerts" />
          </div>
        )}
      </div>

      <section className="rounded-xl border border-border bg-card p-5 space-y-5">
        <h2 className="text-lg font-semibold">Source Configuration</h2>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <label className="block text-base font-semibold">Reed API Key</label>
            <HelpPopover
              title="Reed API setup"
              body="Create a Reed developer key, paste it here, then save settings. You can also set REED_API_KEY before starting the API server."
              copyText={reedSetupCommand}
            />
          </div>
          <input
            type="password"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder={configuredSecrets.has('REED_API_KEY') ? 'Saved. Enter a new key to replace it.' : 'Paste Reed API key'}
            value={form.reedApiKey ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, reedApiKey: e.target.value }))}
          />
          {configuredSecrets.has('REED_API_KEY') && (
            <p className="mt-1 text-sm text-muted-foreground font-medium">A Reed key is already configured.</p>
          )}
        </div>
        <div>
          <label className="block text-base font-semibold mb-2">Slack Webhook URL</label>
          <input
            type="password"
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder={configuredSecrets.has('SLACK_WEBHOOK_URL') ? 'Saved. Enter a new URL to replace it.' : 'https://hooks.slack.com/services/...'}
            value={form.slackWebhookUrl ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, slackWebhookUrl: e.target.value }))}
          />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <label className="block text-base font-semibold">Gmail Credentials JSON</label>
            <HelpPopover
              title="Gmail alerts setup"
              body="Paste Gmail API credentials JSON, set the mailbox email below, and use a search query that matches job alert emails. Current backend health can validate the settings, but Gmail fetching still needs the adapter implementation."
              copyText={gmailSetupCommand}
            />
          </div>
          <textarea
            rows={5}
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
            placeholder={configuredSecrets.has('GMAIL_CREDENTIALS_JSON') ? 'Saved. Paste new JSON to replace it.' : '{"type":"service_account",...}'}
            value={form.gmailCredentialsJson ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, gmailCredentialsJson: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-base font-semibold">Gmail User Email</label>
              <HelpPopover
                title="Mailbox to scan"
                body="Use the Gmail account that receives job alerts. The Gmail credentials must be allowed to read this mailbox."
                copyText="GMAIL_USER_EMAIL=you@your-domain.com"
              />
            </div>
            <input
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="you@your-domain.com"
              value={form.gmailUserEmail ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, gmailUserEmail: e.target.value }))}
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-base font-semibold">Gmail Search Query</label>
              <HelpPopover
                title="Gmail query"
                body="Use Gmail search syntax to narrow alerts, for example unread emails in a job-alerts label."
                copyText="label:job-alerts is:unread"
              />
            </div>
            <input
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="label:job-alerts is:unread"
              value={form.gmailSearchQuery ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, gmailSearchQuery: e.target.value }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-base font-semibold text-blue-500">Indeed Ingest Script</label>
              <HelpPopover
                title="Indeed Ingest Script"
                body="Optional shell script path or command that will be executed when you click 'Ingest Indeed' on the health card. This script is responsible for pushing data to the API."
                copyText="./scripts/ingest_indeed.sh"
              />
            </div>
            <input
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
              placeholder="./scripts/ingest_indeed.sh"
              value={form.indeedIngestScript ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, indeedIngestScript: e.target.value }))}
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-base font-semibold text-blue-500">Indeed Pull Script</label>
              <HelpPopover
                title="Indeed Pull Script"
                body="Optional shell script path or command that will be executed when you click 'Indeed Pull Jobs' on the health card. Typically used for automated scraping."
                copyText="python3 pull_indeed.py"
              />
            </div>
            <input
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
              placeholder="python3 pull_indeed.py"
              value={form.indeedPullScript ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, indeedPullScript: e.target.value }))}
            />
          </div>
        </div>

        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors text-base font-medium"
        >
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Source Settings'}
        </button>
      </section>

      <div className="flex items-center justify-between pt-2">
        <h2 className="text-lg font-semibold">Source Health</h2>
        <button
          onClick={() => void onRefresh()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {sources.length === 0 ? (
        <p className="text-base text-muted-foreground font-medium">Loading sources…</p>
      ) : (
        <div className="grid gap-3">
          {sources.map((s) => <SourceCard key={s.source} source={s} />)}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              Indeed Direct Import
              <HelpPopover
                title="Indeed Direct import"
                body="Paste jobs from your Indeed source, browser automation, MCP plugin, or scraper output. Click Import Indeed Jobs to run the ingest endpoint from this screen."
                copyText={indeedCurlCommand}
              />
            </h2>
            <p className="text-base text-muted-foreground mt-1">
              Paste an array of Indeed jobs, or an object with a jobs/results array. Fields like jobkey, jobTitle,
              companyName, formattedLocation, jobUrl, description, and snippet are accepted.
            </p>
          </div>
          <button
            onClick={() => setIndeedJson(indeedExamplePayload)}
            className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <PlayCircle size={15} />
            Load sample
          </button>
        </div>

        <CommandBlock
          label="Equivalent ingest command"
          command={indeedCurlCommand}
        />

        <div>
          <p className="text-base text-muted-foreground mt-1">
            Running import here calls <code className="bg-muted px-1 rounded">POST /api/jobs/ingest_indeed</code> directly.
            Once jobs are buffered, Indeed Direct turns ready until the API server restarts or you clear/replace the buffer.
          </p>
        </div>
        <textarea
          rows={8}
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
          placeholder={indeedExamplePayload}
          value={indeedJson}
          onChange={(e) => setIndeedJson(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => void ingestIndeed()}
            disabled={ingesting || !indeedJson.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors text-base font-medium"
          >
            <Upload size={18} />
            {ingesting ? 'Importing…' : 'Import Indeed Jobs'}
          </button>
          {ingestMessage && <span className="text-sm text-muted-foreground font-medium">{ingestMessage}</span>}
        </div>
      </div>
    </div>
  );
}

function SourceCard({ source }: { source: SourceHealthInfo }) {
  const help = isSourceName(source.source) ? sourceHelp[source.source] : undefined;
  const jobLoading = useStore((s) => s.jobLoading);
  const runIndeedIngestScript = useStore((s) => s.runIndeedIngestScript);
  const runIndeedPullScript = useStore((s) => s.runIndeedPullScript);

  return (
    <div className={cn(
      'border rounded-xl p-5 space-y-3',
      source.ready ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-card',
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {source.ready
            ? <Wifi size={18} className="text-green-500" />
            : <WifiOff size={18} className="text-muted-foreground" />}
          <span className="font-semibold text-base">{source.source}</span>
          {help && (
            <HelpPopover
              title={`${source.source} status`}
              body={help.body}
              copyText={help.command}
            />
          )}
        </div>
        <span className={cn(
          'text-sm px-2.5 py-1 rounded-full font-bold uppercase tracking-tight',
          source.ready
            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
            : 'bg-muted text-muted-foreground',
        )}>
          {source.ready ? 'Ready' : 'Not Ready'}
        </span>
      </div>

      <div className="text-sm text-muted-foreground space-y-1 font-medium">
        <p><span className="font-bold text-foreground uppercase text-xs tracking-wider mr-1">Mode:</span> {source.mode}</p>
        {source.bufferedJobs > 0 && (
          <p><span className="font-bold text-foreground uppercase text-xs tracking-wider mr-1">Buffered:</span> {source.bufferedJobs} jobs</p>
        )}
        {source.requiredSecret && !source.ready && (
          <p className="text-amber-600 dark:text-amber-400">
            <AlertCircle size={13} className="inline mr-1" />
            {source.requiredSecret}
          </p>
        )}
        {source.lastError && (
          <p className="text-destructive">
            <XCircle size={13} className="inline mr-1" />
            {source.lastError}
          </p>
        )}
      </div>

      {source.source === 'Indeed Direct' && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => void runIndeedIngestScript()}
            disabled={jobLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            <Upload size={14} />
            Ingest Indeed
          </button>
          <button
            onClick={() => void runIndeedPullScript()}
            disabled={jobLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            <RefreshCw size={14} className={cn(jobLoading && 'animate-spin')} />
            Indeed Pull Jobs
          </button>
        </div>
      )}
    </div>
  );
}
