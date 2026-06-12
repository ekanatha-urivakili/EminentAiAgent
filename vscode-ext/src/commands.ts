import * as vscode from "vscode";
import { ApiClient, AgentEvent } from "./apiClient";
import { ChatViewProvider } from "./chatView";

export function registerCommands(ctx: vscode.ExtensionContext, api: ApiClient) {
  const onSelection = (id: string, instruction: string) =>
    vscode.commands.registerCommand(`localforge.${id}`, async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) { return; }
      const sel = ed.document.getText(ed.selection);
      if (!sel) {
        vscode.window.showInformationMessage("Select some code first.");
        return;
      }
      const lang = ed.document.languageId;
      await vscode.commands.executeCommand("localforge.chat.focus");
      ChatViewProvider.current?.post({
        type: "prefill",
        prompt: `${instruction}\n\n\`\`\`${lang}\n${sel}\n\`\`\``
      });
    });

  ctx.subscriptions.push(
    onSelection("explain", "Explain this code precisely. Call out bugs or smells:"),
    onSelection("fix", "Fix the problems in this code. Return only the corrected code:"),
    onSelection("refactor", "Refactor for readability and testability. Explain each change:"),
    onSelection("tests", "Write thorough unit tests:"),

    vscode.commands.registerCommand("localforge.agentEdit", async () => {
      const goal = await vscode.window.showInputBox({
        prompt: "What should the agent change in this workspace?"
      });
      if (!goal) { return; }

      const cfg = vscode.workspace.getConfiguration("localforge");
      const model = cfg.get<string>("chatModel")!;
      const ac = new AbortController();
      let runId: string | undefined;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "LocalForge Agent", cancellable: true },
        async (progress, token) => {
          token.onCancellationRequested(async () => {
            if (runId) { await api.cancel(runId); }
            ac.abort();
          });

          try {
            for await (const ev of api.runAgent(goal, model, ["filesystem", "shell"], ac.signal)) {
              await handleAgentEvent(ev, api, progress, () => runId, id => { runId = id; });
              if (ev.type === "done" || ev.type === "halted" || ev.type === "error") { break; }
            }
          } catch (e) {
            if ((e as Error).name !== "AbortError") {
              vscode.window.showErrorMessage(`Agent run failed: ${String(e)}`);
            }
          }
        }
      );
    }),

    vscode.commands.registerCommand("localforge.pickModel", async () => {
      const models = await api.listModels();
      if (models.length === 0) {
        vscode.window.showWarningMessage("No models found — is the LocalForge backend (and Ollama) running?");
        return;
      }
      const cfg = vscode.workspace.getConfiguration("localforge");
      const pick = await vscode.window.showQuickPick(models, {
        placeHolder: `Current: ${cfg.get<string>("chatModel")}`
      });
      if (pick) {
        await cfg.update("chatModel", pick, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`LocalForge chat model set to ${pick}`);
      }
    })
  );
}

async function handleAgentEvent(
  ev: AgentEvent,
  api: ApiClient,
  progress: vscode.Progress<{ message?: string }>,
  getRunId: () => string | undefined,
  setRunId: (id: string) => void
): Promise<void> {
  switch (ev.type) {
    case "run_started":
      if (ev.runId) { setRunId(ev.runId); }
      progress.report({ message: "running…" });
      break;

    case "thought":
      progress.report({ message: (ev.text ?? "").slice(0, 80) });
      break;

    case "tool_call":
      progress.report({ message: `→ ${ev.tool}` });
      break;

    case "approval_required": {
      const runId = getRunId();
      if (!runId || !ev.stepId) { break; }
      const argsPreview = JSON.stringify(ev.args ?? {}, null, 2);
      const pick = await vscode.window.showWarningMessage(
        `Agent wants to run: ${ev.tool}\n${argsPreview.slice(0, 500)}`,
        { modal: true },
        "Approve", "Reject"
      );
      await api.approve(runId, ev.stepId, pick === "Approve");
      break;
    }

    case "done":
      vscode.window.showInformationMessage(`Agent finished: ${(ev.answer ?? "").slice(0, 200)}`);
      break;

    case "halted":
      vscode.window.showWarningMessage(`Agent halted: ${ev.reason ?? "unknown reason"}`);
      break;

    case "error":
      vscode.window.showErrorMessage(`Agent error: ${ev.message ?? "unknown"}`);
      break;
  }
}
