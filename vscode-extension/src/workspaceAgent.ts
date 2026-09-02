import * as path from 'path';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { validateOllamaUrl } from './llmClient';
import { commandPermission, ALLOWED_EXECUTABLES } from './commandPolicy';
import { shouldPromptForApproval, type ApprovalMode } from './approvalPolicy';
import type { ChatMessage, AgentTaskStep, ModelActivityEntry } from './types';

interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
  images?: string[];
}

interface OllamaAgentResponse {
  message: AgentMessage;
  eval_count?: number;
}

interface OllamaModelList {
  models?: Array<{ name: string; size?: number }>;
}

interface OllamaModelDetails {
  capabilities?: string[];
}

interface OllamaRunningModelList {
  models?: Array<{ name: string }>;
}

export interface WorkspaceAgentCallbacks {
  onDelta: (text: string) => void;
  onStatus: (status: string) => void;
  onFileChange: (change: FileChange) => void;
  onDone: (tokens: number, durationMs: number) => void;
  onError: (error: Error) => void;
  /** Live checklist of everything this run has done so far (tool calls, model swaps, cooldown). */
  onTasks: (tasks: AgentTaskStep[]) => void;
  /** One entry per local model being selected, stopped to free VRAM, or restored afterwards. */
  onModelActivity: (entry: ModelActivityEntry) => void;
}

export interface FileChange {
  path: string;
  beforeContent: string | undefined;
  afterContent: string;
  additions: number;
  deletions: number;
}

const toolSchemas = [
  tool('list_files', 'List files in the open VS Code workspace.', {
    path: stringProperty('Workspace-relative directory, or . for the root'),
  }),
  tool('read_file', 'Read a UTF-8 file from the open VS Code workspace.', {
    path: stringProperty('Workspace-relative file path'),
  }),
  tool('search_content', 'Search text across files in the open VS Code workspace.', {
    query: stringProperty('Text to find'),
  }),
  tool('write_file', 'Create or overwrite a UTF-8 file after user approval.', {
    path: stringProperty('Workspace-relative file path'),
    content: stringProperty('Complete file content'),
  }),
  tool('run_command', 'Run an allowlisted Git, build, test, package, or tool-management command in the workspace.', {
    executable: stringProperty('One of git, npm, npx, dotnet, docker, brew, or code'),
    args: {
      type: 'array',
      items: { type: 'string' },
      description: 'Argument array. Shell operators are not supported.',
    },
  }),
  tool('web_search', 'Search the public web and return source URLs that must be cited.', {
    query: stringProperty('Search query'),
  }),
];

function stringProperty(description: string) {
  return { type: 'string', description };
}

function tool(name: string, description: string, properties: Record<string, object>) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required: Object.keys(properties) },
    },
  };
}

export async function runWorkspaceAgent(
  modelId: string,
  history: ChatMessage[],
  ollamaUrl: string,
  callbacks: WorkspaceAgentCallbacks,
  approvalMode: ApprovalMode,
  requestApproval: (tool: string, summary: string) => Promise<'once' | 'session' | 'reject'>,
  signal: AbortSignal,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    callbacks.onError(new Error('Open a VS Code workspace folder before using Agent mode.'));
    return;
  }

  const started = Date.now();
  const messages: AgentMessage[] = history.map((message) => ({ ...message }));
  let tokens = 0;
  const sessionGrants = new Set<string>();
  const baseUrl = validateOllamaUrl(ollamaUrl);
  let model = '';
  let finalContent: string | undefined;
  let failure: Error | undefined;

  // Live checklist shown in the UI: every entry we push marks the previous one 'done'
  // and appends a new 'active' one, so the whole run ends up as a full step-by-step log.
  const tasks: AgentTaskStep[] = [];
  const pushTask = (label: string) => {
    if (tasks.length) tasks[tasks.length - 1].status = 'done';
    tasks.push({ label, status: 'active' });
    callbacks.onTasks([...tasks]);
  };
  const finishTasks = () => {
    if (tasks.length) tasks[tasks.length - 1].status = 'done';
    callbacks.onTasks([...tasks]);
  };

  try {
    callbacks.onStatus('Routing request');
    pushTask('Routing request');
    const choice = await resolveAutoModel(modelId, messages, baseUrl, signal);
    model = choice.model;
    callbacks.onStatus(`Selected ${model}`);
    pushTask(`Selected ${model} (${choice.purpose})`);
    callbacks.onModelActivity({ ts: Date.now(), action: 'selected', model, purpose: choice.purpose });

    const runningModels = await getRunningModels(baseUrl, signal);
    if (runningModels.length > 0) {
      callbacks.onStatus('Freeing model memory');
      pushTask(`Freeing memory: stopping ${runningModels.join(', ')}`);
      await Promise.all(runningModels.map((name) => unloadModel(baseUrl, name, signal)));
      for (const name of runningModels) {
        callbacks.onModelActivity({ ts: Date.now(), action: 'stopped', model: name });
      }
    }

    callbacks.onStatus('Analysing attachments');
    await addVisionHandoff(messages, ollamaUrl, signal);

    if (isGitReviewRequest(messages)) {
      callbacks.onStatus('Inspecting Git changes');
      pushTask('Inspecting Git changes');
      await preloadGitReviewContext(folder.uri, messages, approvalMode, requestApproval, sessionGrants, signal);
    }

    for (let step = 0; step < 15; step += 1) {
      const thinkingLabel = step === 0 ? 'Thinking' : 'Analysing tool results';
      callbacks.onStatus(thinkingLabel);
      pushTask(thinkingLabel);
      const response = await fetchOllama(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          tools: toolSchemas,
          stream: false,
          keep_alive: '90s',
          options: { num_ctx: 16384 },
        }),
        signal,
      });
      if (!response.ok) throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const turn = await response.json() as OllamaAgentResponse;
      tokens += turn.eval_count ?? 0;
      messages.push(turn.message);

      const calls = turn.message.tool_calls ?? [];
      if (calls.length === 0) {
        finalContent = turn.message.content;
        break;
      }

      for (const call of calls) {
        const label = toolStatus(call);
        callbacks.onStatus(label);
        pushTask(label);
        const result = await executeTool(
          folder.uri, call, approvalMode, requestApproval, sessionGrants, signal, callbacks.onFileChange);
        messages.push({
          role: 'tool',
          content: result,
          tool_name: call.function.name,
        });
      }
    }
    if (finalContent === undefined) throw new Error('Agent step limit reached.');
  } catch (error) {
    failure = friendlyOllamaError(error, baseUrl);
  } finally {
    if (model) {
      callbacks.onStatus('Cooling down');
      pushTask(`Cooling down: stopping ${model}`);
      await unloadModel(baseUrl, model).catch(() => undefined);
      callbacks.onModelActivity({ ts: Date.now(), action: 'stopped', model });
    }
    finishTasks();
  }

  if (failure) {
    callbacks.onError(failure);
    return;
  }
  callbacks.onDelta(finalContent ?? '');
  callbacks.onDone(tokens, Date.now() - started);
}

export interface AutoModelChoice {
  model: string;
  /** Human-readable reason the router picked this model, shown in the model activity log. */
  purpose: string;
}

export async function resolveAutoModel(
  modelId: string,
  messages: Pick<AgentMessage, 'role' | 'content'>[],
  ollamaUrl: string,
  signal: AbortSignal,
): Promise<AutoModelChoice> {
  if (modelId !== 'auto') {
    const model = modelId.startsWith('ollama:') ? modelId.slice('ollama:'.length) : modelId;
    return { model, purpose: 'manually selected' };
  }
  const baseUrl = validateOllamaUrl(ollamaUrl);
  const response = await fetchOllama(`${baseUrl}/api/tags`, { signal });
  if (!response.ok) throw new Error(`Unable to list Ollama models (${response.status}).`);
  const list = await response.json() as OllamaModelList;
  const installed = new Set((list.models ?? []).map((candidate) => candidate.name));
  const request = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const isCoding = /\b(code|file|git|test|build|fix|debug|implement|refactor|review)\b/i.test(request);
  const isArchitecture = /\b(architecture|hld|lld|sequence|diagram|design)\b/i.test(request);
  const purpose = isArchitecture ? 'architecture/planning' : isCoding ? 'coding' : 'general chat';
  const preferences = isArchitecture
    ? ['ornith-1.5:9b', 'gemma4:e4b', 'qwen3.5:9b', 'qwen3.5:4b']
    : isCoding
      ? ['ornith-1.5:9b', 'gemma4:e4b', 'qwen3.5:9b', 'qwen3.5:4b', 'qwen2.5-coder:1.5b']
      : ['gemma4:e4b', 'ornith-1.5:9b', 'qwen3.5:9b', 'qwen3.5:4b', 'qwen2.5:latest'];
  const selected = preferences.find((candidate) => installed.has(candidate))
    ?? [...installed].find((candidate) => !/embed|flux|image/i.test(candidate));
  if (!selected) throw new Error('No compatible local Ollama model is installed.');
  return { model: selected, purpose };
}

export async function getRunningModels(baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetchOllama(`${baseUrl}/api/ps`, { signal });
  if (!response.ok) return [];
  const list = await response.json() as OllamaRunningModelList;
  return (list.models ?? []).map((model) => model.name);
}

export async function unloadModel(baseUrl: string, model: string, signal?: AbortSignal): Promise<void> {
  const response = await fetchOllama(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: 0 }),
    signal,
  });
  if (!response.ok) throw new Error(`Unable to unload ${model} (${response.status}).`);
}

export async function warmModel(baseUrl: string, model: string): Promise<void> {
  const response = await fetchOllama(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: '5m' }),
  });
  if (!response.ok) throw new Error(`Unable to restore ${model} (${response.status}).`);
}

async function fetchOllama(url: string, init: RequestInit, attempts = 2): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw lastError;
}

function friendlyOllamaError(error: unknown, baseUrl: string): Error {
  if (error instanceof Error && (error.message.includes('aborted') || error.name === 'AbortError')) {
    return new Error('Cancelled');
  }
  if (error instanceof TypeError && error.message === 'fetch failed') {
    return new Error(`Cannot reach Ollama at ${baseUrl}. Start Ollama, then retry.`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function toolStatus(call: ToolCall): string {
  const labels: Record<string, string> = {
    list_files: 'Exploring workspace',
    read_file: 'Reading files',
    search_content: 'Searching code',
    write_file: 'Applying changes',
    run_command: 'Running command',
    web_search: 'Searching the web',
  };
  if (call.function.name === 'run_command') {
    const executable = call.function.arguments.executable;
    const args = call.function.arguments.args;
    if (executable === 'git' && Array.isArray(args)) return `Running git ${String(args[0] ?? '')}`.trim();
  }
  return labels[call.function.name] ?? 'Working';
}

async function addVisionHandoff(
  messages: AgentMessage[],
  ollamaUrl: string,
  signal: AbortSignal,
): Promise<void> {
  const imageMessages = messages.filter((message) => message.images?.length);
  if (imageMessages.length === 0) return;

  const baseUrl = validateOllamaUrl(ollamaUrl);
  const visionModel = await findVisionModel(baseUrl, signal);
  if (!visionModel) {
    throw new Error(
      'Images are attached, but no installed Ollama model advertises the vision capability. '
      + 'Install one with `ollama pull gemma3:4b`, refresh models, and retry.',
    );
  }

  const images = imageMessages.flatMap((message) => message.images ?? []);
  const request = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const response = await fetchOllama(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: visionModel,
      stream: false,
      messages: [{
        role: 'user',
        content: [
          'Analyze these reference images for a software-engineering agent that will implement the requested change.',
          'Return structured, concrete observations: layout, components, controls, visible states, interactions, text, colors, spacing, and differences between images.',
          'Do not propose code and do not claim to inspect repository files.',
          `User request: ${request}`,
        ].join('\n'),
        images,
      }],
      keep_alive: 0,
      options: { temperature: 0.1, num_ctx: 16384 },
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Vision model ${visionModel} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }

  const result = await response.json() as OllamaAgentResponse;
  const analysis = result.message?.content?.trim();
  if (!analysis) throw new Error(`Vision model ${visionModel} returned no image analysis.`);

  for (const message of imageMessages) delete message.images;
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  if (latestUser) {
    latestUser.content += [
      '',
      `Vision handoff from ${visionModel}:`,
      analysis,
      '',
      'Use this image analysis as reference context. Inspect the workspace with tools before editing, implement the request, and verify the result.',
    ].join('\n');
  }
}

async function findVisionModel(baseUrl: string, signal: AbortSignal): Promise<string | undefined> {
  const response = await fetchOllama(`${baseUrl}/api/tags`, { signal });
  if (!response.ok) throw new Error(`Unable to list Ollama models (${response.status}).`);
  const list = await response.json() as OllamaModelList;
  const models = [...(list.models ?? [])].sort((a, b) => (a.size ?? Number.MAX_SAFE_INTEGER) - (b.size ?? Number.MAX_SAFE_INTEGER));
  const preferred = vscode.workspace.getConfiguration('eminentai').get<string>('visionModel', '').trim();
  if (preferred) {
    const index = models.findIndex((model) => model.name === preferred);
    if (index >= 0) models.unshift(...models.splice(index, 1));
  }

  for (const model of models) {
    const detailsResponse = await fetchOllama(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.name }),
      signal,
    });
    if (!detailsResponse.ok) continue;
    const details = await detailsResponse.json() as OllamaModelDetails;
    if (details.capabilities?.includes('vision')) return model.name;
  }
  return undefined;
}

function isGitReviewRequest(messages: AgentMessage[]): boolean {
  const request = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  return /\b(code\s*review|review)\b/i.test(request)
    && /\b(git|status|diff|changes?|modified|staged|unstaged|current project)\b/i.test(request);
}

async function preloadGitReviewContext(
  root: vscode.Uri,
  messages: AgentMessage[],
  approvalMode: ApprovalMode,
  requestApproval: (tool: string, summary: string) => Promise<'once' | 'session' | 'reject'>,
  sessionGrants: Set<string>,
  signal: AbortSignal,
): Promise<void> {
  const calls: ToolCall[] = [
    commandCall('git-review-status', ['status', '--short']),
    commandCall('git-review-stat', ['diff', '--stat']),
    commandCall('git-review-unstaged', ['diff', '--no-ext-diff', '--unified=40']),
    commandCall('git-review-staged', ['diff', '--cached', '--no-ext-diff', '--unified=40']),
  ];
  messages.push({
    role: 'assistant',
    content: '',
    tool_calls: calls,
  });
  for (const call of calls) {
    const result = await executeTool(root, call, approvalMode, requestApproval, sessionGrants, signal);
    messages.push({
      role: 'tool',
      content: result,
      tool_name: call.function.name,
    });
  }
  messages.push({
    role: 'system',
    content: 'Review only the supplied Git evidence. Inspect relevant files with read_file when a diff is truncated or more context is required. Omit generic advice and unsupported findings. If no actionable defect is proven, say so.',
  });
}

function commandCall(id: string, args: string[]): ToolCall {
  return {
    id,
    function: {
      name: 'run_command',
      arguments: { executable: 'git', args },
    },
  };
}

async function executeTool(
  root: vscode.Uri,
  call: ToolCall,
  approvalMode: ApprovalMode,
  requestApproval: (tool: string, summary: string) => Promise<'once' | 'session' | 'reject'>,
  sessionGrants: Set<string>,
  signal: AbortSignal,
  onFileChange: (change: FileChange) => void = () => {},
): Promise<string> {
  const args = call.function.arguments;
  switch (call.function.name) {
    case 'list_files': {
      const relative = getString(args, 'path', '.');
      const base = resolveInWorkspace(root, relative);
      await assertInsideRealWorkspace(root, base);
      const pattern = new vscode.RelativePattern(base, '**/*');
      const files = await vscode.workspace.findFiles(pattern, '**/{.git,node_modules,bin,obj,dist}/**', 500);
      return JSON.stringify(files.map((uri) => path.relative(root.fsPath, uri.fsPath)));
    }
    case 'read_file': {
      const relative = getString(args, 'path');
      const target = resolveInWorkspace(root, relative);
      await assertInsideRealWorkspace(root, target);
      let bytes: Uint8Array;
      try {
        bytes = await vscode.workspace.fs.readFile(target);
      } catch (error) {
        // Models routinely call read_file first to check whether something exists before
        // deciding to create or edit it. Throwing here used to kill the whole agent turn on
        // a perfectly normal "doesn't exist yet" case — return a result the model can act on
        // (i.e. call write_file next) instead of aborting the run.
        const code = (error as { code?: string } | undefined)?.code;
        if (code === 'FileNotFound' || code === 'ENOENT' || /ENOENT|FileNotFound/i.test(String((error as Error)?.message))) {
          return JSON.stringify({
            error: 'not_found',
            path: relative,
            message: `No file exists at '${relative}' yet. Use write_file to create it.`,
          });
        }
        throw error;
      }
      if (bytes.byteLength > 1_000_000) throw new Error('File exceeds the 1 MB read limit.');
      return new TextDecoder().decode(bytes);
    }
    case 'search_content': {
      const query = getString(args, 'query');
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, '**/*'),
        '**/{.git,node_modules,bin,obj,dist}/**',
        300,
      );
      const matches: { path: string; line: number; text: string }[] = [];
      for (const file of files) {
        if (signal.aborted || matches.length >= 100) break;
        try {
          await assertInsideRealWorkspace(root, file);
          const bytes = await vscode.workspace.fs.readFile(file);
          if (bytes.byteLength > 1_000_000) continue;
          const lines = new TextDecoder().decode(bytes).split('\n');
          lines.forEach((line, index) => {
            if (matches.length < 100 && line.toLowerCase().includes(query.toLowerCase())) {
              matches.push({ path: path.relative(root.fsPath, file.fsPath), line: index + 1, text: line.slice(0, 300) });
            }
          });
        } catch { }
      }
      return JSON.stringify(matches);
    }
    case 'write_file': {
      const relative = getString(args, 'path');
      const content = getString(args, 'content', '');
      const permission = `write:${relative}`;
      if (shouldPromptForApproval('write_file', permission, approvalMode) && !sessionGrants.has(permission)) {
        const decision = await requestApproval('write_file', `Write ${relative} in ${root.fsPath}`);
        if (decision === 'reject') return JSON.stringify({ rejected: true });
        if (decision === 'session') sessionGrants.add(permission);
      }
      const target = resolveInWorkspace(root, relative);
      await assertInsideRealWorkspace(root, target);
      let beforeContent: string | undefined;
      try {
        beforeContent = new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
      } catch {
        beforeContent = undefined;
      }
      const parent = vscode.Uri.file(path.dirname(target.fsPath));
      try {
        await vscode.workspace.fs.createDirectory(parent);
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content));
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String(error.code) : undefined;
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Unable to write workspace file '${relative}'${code ? ` (${code})` : ''}: ${detail}. `
          + 'Inspect the project and use the actual workspace-relative source path.',
        );
      }
      const stats = changedLineCounts(beforeContent ?? '', content);
      onFileChange({ path: relative, beforeContent, afterContent: content, ...stats });
      return JSON.stringify({ path: relative, permission, bytesWritten: Buffer.byteLength(content) });
    }
    case 'run_command':
      return runCommand(root, args, approvalMode, requestApproval, sessionGrants, signal);
    case 'web_search':
      return searchWeb(getString(args, 'query'), signal);
    default:
      throw new Error(`Unknown tool: ${call.function.name}`);
  }
}

function changedLineCounts(before: string, after: string): { additions: number; deletions: number } {
  const oldLines = before ? before.split('\n') : [];
  const newLines = after ? after.split('\n') : [];
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;
  return {
    additions: Math.max(0, newLines.length - prefix - suffix),
    deletions: Math.max(0, oldLines.length - prefix - suffix),
  };
}

async function runCommand(
  root: vscode.Uri,
  args: Record<string, unknown>,
  approvalMode: ApprovalMode,
  requestApproval: (tool: string, summary: string) => Promise<'once' | 'session' | 'reject'>,
  sessionGrants: Set<string>,
  signal: AbortSignal,
): Promise<string> {
  const executable = getString(args, 'executable');
  const commandArgs = getStringArray(args, 'args');
  if (!ALLOWED_EXECUTABLES.has(executable)) throw new Error(`Executable is not allowlisted: ${executable}`);
  const permission = commandPermission(executable, commandArgs);
  const summary = [executable, ...commandArgs].join(' ');
  if (shouldPromptForApproval(executable, permission, approvalMode) && !sessionGrants.has(permission)) {
    const decision = await requestApproval('run_command', summary);
    if (decision === 'reject') return JSON.stringify({ rejected: true, command: summary });
    if (decision === 'session') sessionGrants.add(permission);
  }

  // Defensive check: a raw Node "spawn ENOTDIR" from a bad cwd is nearly undiagnosable once it
  // reaches the chat as a bare error string. Confirm the workspace root itself still resolves to
  // a real directory before we ever hand it to child_process, so a moved/deleted/renamed folder
  // fails with a clear message instead of an opaque native error.
  try {
    const stat = await vscode.workspace.fs.stat(root);
    if (stat.type !== vscode.FileType.Directory) {
      throw new Error(`Workspace root ${root.fsPath} is not a directory.`);
    }
  } catch {
    throw new Error(
      `Cannot run '${summary}': the workspace folder ${root.fsPath} no longer resolves to a real `
      + 'directory. If it was moved, renamed, or is on an unmounted drive, close and reopen the folder in VS Code.',
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, commandArgs, {
      cwd: root.fsPath,
      shell: false,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 60_000);
    const abort = () => child.kill('SIGTERM');
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { stdout = clamp(stdout + chunk.toString()); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = clamp(stderr + chunk.toString()); });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      const code = err.code;
      const hint = code === 'ENOENT'
        ? `'${executable}' was not found. Make sure it's installed and on PATH for the shell VS Code was launched from.`
        : code === 'ENOTDIR'
          ? `A path component for '${executable}' or its resolved location isn't a real directory — this is `
            + 'commonly a stale nvm/volta/asdf shim. Try running the same command directly in a terminal to '
            + 'confirm it still works, then reopen this workspace.'
          : err.message;
      reject(new Error(`Failed to run '${summary}' in ${root.fsPath}${code ? ` (${code})` : ''}: ${hint}`));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(JSON.stringify({ command: summary, exitCode, stdout, stderr }));
    });
  });
}


function getStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Missing string-array argument: ${key}`);
  }
  return value;
}

function clamp(value: string): string {
  return value.length <= 12_000 ? value : `${value.slice(0, 12_000)}… [truncated]`;
}

function resolveInWorkspace(root: vscode.Uri, relative: string): vscode.Uri {
  const target = path.isAbsolute(relative) ? path.resolve(relative) : path.resolve(root.fsPath, relative);
  const prefix = root.fsPath.endsWith(path.sep) ? root.fsPath : `${root.fsPath}${path.sep}`;
  if (target !== root.fsPath && !target.startsWith(prefix)) throw new Error('Path escapes the open workspace.');
  return vscode.Uri.file(target);
}

async function assertInsideRealWorkspace(root: vscode.Uri, target: vscode.Uri): Promise<void> {
  const realRoot = await fs.realpath(root.fsPath);
  let existing = target.fsPath;
  while (true) {
    try {
      await fs.lstat(existing);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error('Unable to resolve workspace path.');
      existing = parent;
    }
  }
  const realExisting = await fs.realpath(existing);
  const resolvedTarget = path.resolve(realExisting, path.relative(existing, target.fsPath));
  const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (resolvedTarget !== realRoot && !resolvedTarget.startsWith(prefix)) {
    throw new Error('Path escapes the open workspace through a symbolic link.');
  }
}

function getString(args: Record<string, unknown>, key: string, fallback?: string): string {
  const value = args[key];
  if (typeof value === 'string') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing string argument: ${key}`);
}

async function searchWeb(query: string, signal: AbortSignal): Promise<string> {
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey) throw new Error('Set OLLAMA_API_KEY before using web search.');
  const response = await fetch('https://ollama.com/api/web_search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: 5 }),
    signal,
  });
  if (!response.ok) throw new Error(`Ollama web search failed: ${response.status}`);
  return response.text();
}
