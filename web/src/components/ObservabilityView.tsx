import { useState, useEffect } from 'react';
import { Activity, Cpu, Database, HardDrive, AlertCircle, CheckCircle2, Zap, Clock, Package } from 'lucide-react';
import { api } from '../lib/api';
import { formatBytes } from '../lib/utils';
import type { ObservabilityData } from '../lib/types';
import { cn } from '../lib/utils';

export function ObservabilityView() {
  const [data, setData] = useState<ObservabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await api.observability();
      setData(res);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <Activity className="animate-pulse" size={48} />
        <p>Loading observability metrics...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-destructive p-8 text-center">
        <AlertCircle size={48} />
        <h2 className="text-xl font-bold">Failed to load metrics</h2>
        <p className="max-w-md">{error}</p>
        <button onClick={() => void fetchData()} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 pb-28 space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Activity size={18} />
          <span className="text-sm font-medium uppercase tracking-wider">System Status</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight">Observability</h1>
        <p className="mt-2 text-muted-foreground">
          Real-time monitoring of local resources, LLM models, and agent health.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {/* CPU Card */}
        <MetricCard
          title="CPU Usage"
          icon={<Cpu size={20} className="text-blue-500" />}
          value={`${data.system.cpuUsagePercent.toFixed(1)}%`}
          progress={data.system.cpuUsagePercent}
          color="bg-blue-500"
        />

        {/* Memory Card */}
        <MetricCard
          title="System RAM"
          icon={<Database size={20} className="text-emerald-500" />}
          value={formatBytes(data.system.memoryUsedBytes)}
          subtitle={`of ${formatBytes(data.system.memoryTotalBytes)}`}
          progress={(data.system.memoryUsedBytes / data.system.memoryTotalBytes) * 100}
          color="bg-emerald-500"
        />

        {/* Disk Card */}
        <MetricCard
          title="Disk Usage"
          icon={<HardDrive size={20} className="text-amber-500" />}
          value={formatBytes(data.system.diskUsedBytes)}
          subtitle={`of ${formatBytes(data.system.diskTotalBytes)}`}
          progress={(data.system.diskUsedBytes / data.system.diskTotalBytes) * 100}
          color="bg-amber-500"
        />

        {/* GPU Card (if available) */}
        <MetricCard
          title="GPU / Neural Engine"
          icon={<Zap size={20} className="text-purple-500" />}
          value={data.system.gpu ? `${data.system.gpu.name}` : 'Unified'}
          subtitle={data.system.gpu ? `${data.system.gpu.usagePercent.toFixed(1)}% usage` : 'System shared'}
          progress={data.system.gpu?.usagePercent ?? 0}
          color="bg-purple-500"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Loaded Models */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Package size={18} className="text-muted-foreground" />
              Loaded Models (VRAM)
            </h2>
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
              data.ollamaOk ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
            )}>
              {data.ollamaOk ? 'Ollama Online' : 'Ollama Offline'}
            </div>
          </div>
          <div className="p-5">
            {!data.ollamaOk ? (
              <div className="text-center py-8 text-destructive italic text-sm">
                Ollama is currently unreachable. Check if it's running.
              </div>
            ) : data.loadedModels.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground italic text-sm">
                No models currently loaded in memory.
              </div>
            ) : (
              <div className="space-y-4">
                {data.loadedModels.map((m) => (
                  <div key={m.name} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-medium">{m.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(m.sizeBytesVram)} in VRAM
                      </span>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary" 
                        style={{ width: `${Math.min(100, (m.sizeBytesVram / m.sizeBytes) * 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Total: {formatBytes(m.sizeBytes)}</span>
                      {m.expiresAt && (
                        <span className="flex items-center gap-1">
                          <Clock size={10} /> Unloads in {Math.round((new Date(m.expiresAt).getTime() - Date.now()) / 60000)}m
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Job Search Health */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Activity size={18} className="text-muted-foreground" />
              Job Search Agent
            </h2>
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
              data.jobSearch.allSourcesHealthy ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
            )}>
              {data.jobSearch.allSourcesHealthy ? (
                <>
                  <CheckCircle2 size={12} />
                  Healthy
                </>
              ) : (
                <>
                  <AlertCircle size={12} />
                  Issues
                </>
              )}
            </div>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-muted/40 p-4 rounded-xl">
                <div className="text-xs text-muted-foreground mb-1 uppercase font-bold tracking-tighter">Last Run</div>
                <div className="text-sm font-semibold truncate">
                  {data.jobSearch.lastRunAt ? new Date(data.jobSearch.lastRunAt).toLocaleTimeString() : 'Never'}
                </div>
              </div>
              <div className="bg-muted/40 p-4 rounded-xl">
                <div className="text-xs text-muted-foreground mb-1 uppercase font-bold tracking-tighter">Matches</div>
                <div className="text-sm font-semibold">
                  {data.jobSearch.lastRunMatches} jobs
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1">Source Health</h3>
              {data.jobSearch.issues.length === 0 ? (
                <div className="flex items-center gap-2 p-3 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 text-sm rounded-lg border border-emerald-500/20">
                  <CheckCircle2 size={16} />
                  All job sources are configured and reachable.
                </div>
              ) : (
                <div className="space-y-2">
                  {data.jobSearch.issues.map((issue, idx) => (
                    <div key={idx} className="p-3 bg-red-500/5 text-red-600 dark:text-red-400 text-sm rounded-lg border border-red-500/20 flex flex-col gap-1">
                      <div className="font-bold flex items-center gap-2">
                        <AlertCircle size={14} />
                        {issue.source}
                      </div>
                      <div className="text-xs opacity-80 pl-5">{issue.error}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({ title, icon, value, subtitle, progress, color }: {
  title: string;
  icon: React.ReactNode;
  value: string;
  subtitle?: string;
  progress?: number;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
      </div>
      {progress !== undefined && (
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div 
            className={cn("h-full transition-all duration-500", color)} 
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
    </div>
  );
}
