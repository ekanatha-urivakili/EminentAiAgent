"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCommands = registerCommands;
const vscode = __importStar(require("vscode"));
const chatView_1 = require("./chatView");
function fullRange(content) {
    const lines = content.split('\\n');
    return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lines.length, 0));
}
function registerCommands(ctx, api) {
    const onSelection = (id, instruction) => vscode.commands.registerCommand(`localforge.\${id}`, async () => {
        const ed = vscode.window.activeTextEditor;
        if (!ed)
            return;
        const sel = ed.document.getText(ed.selection);
        const lang = ed.document.languageId;
        // route to chat sidebar with a prepared prompt
        await vscode.commands.executeCommand("localforge.chat.focus");
        chatView_1.ChatViewProvider.current?.post({
            type: "prefill",
            prompt: `\${instruction}\\n\\n\`\`\`\${lang}\\n\${sel}\\n\`\`\``
        });
    });
    ctx.subscriptions.push(onSelection("explain", "Explain this code precisely. Call out bugs or smells:"), onSelection("fix", "Fix the problems in this code. Return only the corrected code:"), onSelection("refactor", "Refactor for readability and testability. Explain each change:"), onSelection("tests", "Write thorough unit tests:"), vscode.commands.registerCommand("localforge.agentEdit", async () => {
        const goal = await vscode.window.showInputBox({
            prompt: "What should the agent change in this workspace?"
        });
        if (!goal)
            return;
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const run = await api.startAgentRun({ goal, connectors: ["filesystem"], cwd: root });
        for await (const ev of api.streamRun(run.id)) {
            if (ev.type === "file_edit_proposed") {
                const orig = vscode.Uri.file(ev.path);
                const proposed = orig.with({ scheme: "localforge-proposed" });
                await vscode.commands.executeCommand("vscode.diff", orig, proposed, `LocalForge: \${ev.path}`);
                const pick = await vscode.window.showInformationMessage(`Apply changes to \${vscode.workspace.asRelativePath(ev.path)}?`, "Apply", "Skip", "Abort run");
                if (pick === "Apply") {
                    const we = new vscode.WorkspaceEdit();
                    we.replace(orig, fullRange(ev.original), ev.proposed);
                    await vscode.workspace.applyEdit(we);
                    await api.approve(run.id, ev.stepId, true);
                }
                else if (pick === "Abort run") {
                    await api.cancel(run.id);
                    break;
                }
                else {
                    await api.approve(run.id, ev.stepId, false);
                }
            }
            if (ev.type === "approval_required") {
                const result = await vscode.window.showWarningMessage(`Agent wants: \${ev.tool} \${JSON.stringify(ev.args)}`, "Approve", "Reject");
                await api.approve(run.id, ev.stepId, result === "Approve");
            }
        }
    }), vscode.commands.registerCommand("localforge.pickModel", async () => {
        vscode.window.showInformationMessage("Model picker not fully implemented yet.");
    }));
}
//# sourceMappingURL=commands.js.map