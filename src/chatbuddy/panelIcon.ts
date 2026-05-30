/**
 * 面板图标路径解析模块。
 *
 * 为 WebViewPanel 提供图标路径解析，支持 Codicon 符号和自定义 SVG 图标。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { warn } from './utils';

const symbolDataCache = new Map<string, { viewBox: string; symbolInner: string } | undefined>();
const symbolSvgCache = new Map<string, vscode.Uri>();
let codiconSpriteCache: string | undefined;

function escapeRegexLiteral(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeIconId(iconId: string): string {
  const normalized = iconId.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9-]+$/.test(normalized)) {
    return 'account';
  }
  return normalized;
}

function resolveCodiconSpritePath(): string | undefined {
  if (codiconSpriteCache !== undefined) {
    return codiconSpriteCache;
  }
  const candidates = [
    path.join(vscode.env.appRoot, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.svg'),
    path.join('/opt/visual-studio-code/resources/app/node_modules/@vscode/codicons/dist/codicon.svg'),
    path.join('/opt/vscodium-bin/resources/app/node_modules/@vscode/codicons/dist/codicon.svg'),
    path.join('/usr/share/trae/resources/app/node_modules/@vscode/codicons/dist/codicon.svg'),
    path.join('/usr/share/trae-cn/resources/app/node_modules/@vscode/codicons/dist/codicon.svg')
  ];
  codiconSpriteCache = candidates.find((candidate) => fs.existsSync(candidate));
  return codiconSpriteCache;
}

function toDataUri(svg: string): vscode.Uri {
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

function extractSymbolData(symbolId: string): { viewBox: string; symbolInner: string } | undefined {
  const normalizedId = normalizeIconId(symbolId);
  if (symbolDataCache.has(normalizedId)) {
    return symbolDataCache.get(normalizedId);
  }
  const spritePath = resolveCodiconSpritePath();
  if (!spritePath) {
    symbolDataCache.set(normalizedId, undefined);
    return undefined;
  }
  let source = '';
  try {
    source = fs.readFileSync(spritePath, 'utf8');
  } catch (err) {
    warn('Error reading codicon sprite:', err);
    symbolDataCache.set(normalizedId, undefined);
    return undefined;
  }
  const idPattern = escapeRegexLiteral(normalizedId);
  const symbolMatch = source.match(new RegExp(`<symbol\\b([^>]*)\\bid="${idPattern}"([^>]*)>([\\s\\S]*?)<\\/symbol>`));
  if (!symbolMatch) {
    symbolDataCache.set(normalizedId, undefined);
    return undefined;
  }
  const attrText = `${symbolMatch[1]} ${symbolMatch[2]}`;
  const viewBoxMatch = attrText.match(/\bviewBox="([^"]+)"/);
  const viewBox = viewBoxMatch?.[1] ?? '0 0 16 16';
  const symbolInner = symbolMatch[3];
  const data = { viewBox, symbolInner };
  symbolDataCache.set(normalizedId, data);
  return data;
}

function extractSymbolSvg(symbolId: string, color: string): vscode.Uri | undefined {
  const normalizedId = normalizeIconId(symbolId);
  const cacheKey = `${normalizedId}:${color}`;
  const cached = symbolSvgCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const data = extractSymbolData(normalizedId);
  if (!data) {
    return undefined;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${data.viewBox}" fill="${color}">${data.symbolInner}</svg>`;
  const uri = toDataUri(svg);
  symbolSvgCache.set(cacheKey, uri);
  return uri;
}

export function getPanelIconPath(iconId: string): vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } {
  const light = extractSymbolSvg(iconId, '#424242');
  const dark = extractSymbolSvg(iconId, '#c5c5c5');
  if (light && dark) {
    return {
      light,
      dark
    };
  }
  const fallbackLight = extractSymbolSvg('account', '#424242');
  const fallbackDark = extractSymbolSvg('account', '#c5c5c5');
  if (fallbackLight && fallbackDark) {
    return {
      light: fallbackLight,
      dark: fallbackDark
    };
  }
  // Fallback for environments without VS Code codicons (e.g. CI)
  const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#888"/></svg>`;
  const uri = toDataUri(fallbackSvg);
  return { light: uri, dark: uri };
}
