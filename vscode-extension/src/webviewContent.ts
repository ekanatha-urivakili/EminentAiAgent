import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/** Cache template so disk is only read once per activation. */
let _htmlTemplate: string | null = null;

export function getWebviewContent(_webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = generateNonce();

  const csp = [
    `default-src 'none'`,
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    `img-src data: blob:`,
    `font-src 'none'`,
  ].join('; ');

  if (!_htmlTemplate) {
    const htmlPath = path.join(extensionUri.fsPath, 'media', 'chat.html');
    _htmlTemplate = fs.readFileSync(htmlPath, 'utf8');
  }
  let html = _htmlTemplate;

  // Inject CSP and nonce
  html = html
    .replace('__CSP__', csp)
    .replace(/__NONCE__/g, nonce);

  return html;
}

function generateNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
