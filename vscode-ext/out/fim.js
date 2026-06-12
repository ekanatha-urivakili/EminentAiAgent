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
exports.FimProvider = void 0;
const vscode = __importStar(require("vscode"));
class FimProvider {
    api;
    cfg;
    inflight;
    cache = new Map(); // LRU in practice
    constructor(api, cfg) {
        this.api = api;
        this.cfg = cfg;
    }
    async provideInlineCompletionItems(doc, pos, _ctx, token) {
        if (!this.cfg().get("inlineCompletions"))
            return [];
        this.inflight?.abort(); // kill stale request
        const ac = new AbortController();
        this.inflight = ac;
        token.onCancellationRequested(() => ac.abort());
        await new Promise(r => setTimeout(r, 300)); // debounce
        if (ac.signal.aborted)
            return [];
        const prefix = doc.getText(new vscode.Range(new vscode.Position(0, 0), pos)).slice(-8000);
        const suffix = doc.getText(new vscode.Range(pos, new vscode.Position(doc.lineCount, 0))).slice(0, 2000);
        const key = `\${doc.uri.toString()}|\${prefix.slice(-200)}`;
        const text = this.cache.get(key)
            ?? await this.api.fim(prefix, suffix, this.cfg().get("fimModel"), ac.signal)
                .catch(() => "");
        if (!text || ac.signal.aborted)
            return [];
        this.cache.set(key, text);
        return [new vscode.InlineCompletionItem(text, new vscode.Range(pos, pos))];
    }
}
exports.FimProvider = FimProvider;
//# sourceMappingURL=fim.js.map