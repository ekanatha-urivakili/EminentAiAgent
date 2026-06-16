import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getWebviewContent(_webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = generateNonce();

  const csp = [
    `default-src 'none'`,
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    `img-src data: blob:`,
    `font-src 'none'`,
  ].join('; ');

  const htmlPath = path.join(extensionUri.fsPath, 'media', 'chat.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

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
