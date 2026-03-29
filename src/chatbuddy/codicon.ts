import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  toCssStringLiteral,
  toCssContentLiteral,
  normalizeCssToken,
  parseJsonLike,
  normalizeThemeToken,
  normalizeFontFamilyToken
} from './codiconUtils';

const CODICON_CANDIDATE_DIRS: ReadonlyArray<string> = [
  path.join('out', 'vs', 'base', 'browser', 'ui', 'codicons', 'codicon'),
  path.join('node_modules', '@vscode', 'codicons', 'dist'),
  path.join('extensions', 'simple-browser', 'media')
];

type ProductIconThemeContribution = {
  id?: unknown;
  label?: unknown;
  path?: unknown;
};

type ProductIconThemeCandidate = {
  extensionId: string;
  id: string;
  label: string;
  path: string;
  resolvedPath: string;
  source: 'runtime-extensions' | 'app-extensions-scan';
};

type ProductIconThemeSource = {
  path?: unknown;
  format?: unknown;
};

type ProductIconThemeFont = {
  id?: unknown;
  src?: unknown;
  weight?: unknown;
  style?: unknown;
};

type ProductIconDefinition = {
  fontCharacter?: unknown;
  fontId?: unknown;
};

type ProductIconThemeFile = {
  fonts?: unknown;
  iconDefinitions?: unknown;
};

const CODICON_FONT_FILES: ReadonlyArray<string> = ['codicon.woff2', 'codicon.woff', 'codicon.ttf', 'codicon.otf'];
// 优化：减少扫描深度和范围，提高性能 (浮浮酱的优化喵～)
const CODICON_SCAN_MAX_DEPTH = 5;
const CODICON_SCAN_MAX_DIRS = 500;
const CODICON_SCAN_MAX_RESULTS = 10;

const codiconRootCache = new Map<string, vscode.Uri>();
const productIconThemeCandidatesCache = new Map<string, ProductIconThemeCandidate[]>();

type CodiconDiscoveredRoot = {
  absolutePath: string;
  hasFonts: boolean;
  cssLength: number;
  score: number;
};

type HostCodiconOverrideResult = {
  workbenchCssPath?: string;
  configuredFontFamilyChain: string[];
  injectedFontFamilies: string[];
  cssText: string;
};

function buildLanguageCandidates(language: string): string[] {
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const variants = new Set<string>([normalized]);
  variants.add(normalized.replace(/_/g, '-'));
  if (normalized.includes('-')) {
    variants.add(normalized.split('-', 1)[0]);
  }
  return [...variants];
}

const packageNlsCache = new Map<string, Record<string, unknown>>();

function readPackageNlsValue(extensionPath: string, key: string): string | undefined {
  const cacheKey = `${extensionPath}::${vscode.env.language}`;
  let nlsMap = packageNlsCache.get(cacheKey);
  if (!nlsMap) {
    const candidates = buildLanguageCandidates(vscode.env.language).map((lang) => `package.nls.${lang}.json`);
    candidates.push('package.nls.json');
    nlsMap = {};
    for (const fileName of candidates) {
      const filePath = path.join(extensionPath, fileName);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      try {
        const parsed = parseJsonLike<Record<string, unknown>>(fs.readFileSync(filePath, 'utf8'));
        if (!parsed) {
          continue;
        }
        nlsMap = parsed;
        break;
      } catch {
        continue;
      }
    }
    packageNlsCache.set(cacheKey, nlsMap);
  }

  const value = nlsMap[key];
  return typeof value === 'string' ? value : undefined;
}

function resolveThemeLabel(rawLabel: string, extensionPath: string): string {
  const match = rawLabel.match(/^%(.+)%$/);
  if (!match) {
    return rawLabel;
  }
  const localized = readPackageNlsValue(extensionPath, match[1]);
  return localized ?? rawLabel;
}

function appendProductIconThemeCandidates(
  target: Map<string, ProductIconThemeCandidate>,
  extensionId: string,
  extensionPath: string,
  packageJson: { contributes?: { productIconThemes?: unknown } },
  source: ProductIconThemeCandidate['source']
): void {
  const contributions = packageJson.contributes?.productIconThemes;
  if (!Array.isArray(contributions)) {
    return;
  }

  for (const contribution of contributions) {
    const item = contribution as ProductIconThemeContribution;
    if (typeof item.path !== 'string' || !item.path.trim()) {
      continue;
    }
    const resolvedPath = path.resolve(extensionPath, item.path);
    const key = resolvedPath.toLowerCase();
    if (target.has(key)) {
      continue;
    }
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const rawLabel = typeof item.label === 'string' ? item.label.trim() : '';
    target.set(key, {
      extensionId,
      id,
      label: rawLabel ? resolveThemeLabel(rawLabel, extensionPath) : rawLabel,
      path: item.path,
      resolvedPath,
      source
    });
  }
}

// 优化：简化扩展扫描，只扫描必要的内置扩展 (浮浮酱的优化喵～)
function scanAppExtensionsForProductIconThemes(target: Map<string, ProductIconThemeCandidate>): void {
  const extensionsRoot = path.join(vscode.env.appRoot, 'extensions');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(extensionsRoot, { withFileTypes: true });
  } catch {
    return;
  }

  // 只扫描可能包含图标主题的扩展 (减少不必要的扫描喵～)
  const relevantExtensions = entries.filter(entry => {
    if (!entry.isDirectory()) {
      return false;
    }
    const name = entry.name.toLowerCase();
    return name.includes('theme') || name.includes('icon') || name === 'simple-browser';
  });

  for (const entry of relevantExtensions) {
    const extensionPath = path.join(extensionsRoot, entry.name);
    const packageJsonPath = path.join(extensionPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    try {
      const parsed = parseJsonLike<{ name?: unknown; publisher?: unknown; contributes?: { productIconThemes?: unknown } }>(
        fs.readFileSync(packageJsonPath, 'utf8')
      );
      if (!parsed) {
        continue;
      }
      const name = typeof parsed.name === 'string' ? parsed.name : entry.name;
      const publisher = typeof parsed.publisher === 'string' ? parsed.publisher : 'builtin';
      const extensionId = `${publisher}.${name}`;
      appendProductIconThemeCandidates(target, extensionId, extensionPath, parsed, 'app-extensions-scan');
    } catch {
      continue;
    }
  }
}

function collectProductIconThemeCandidates(): ProductIconThemeCandidate[] {
  const cacheKey = `${vscode.env.appRoot}::${vscode.env.language}`;
  const cached = productIconThemeCandidatesCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const candidatesByPath = new Map<string, ProductIconThemeCandidate>();

  for (const extension of vscode.extensions.all) {
    const packageJson = extension.packageJSON as { contributes?: { productIconThemes?: unknown } };
    appendProductIconThemeCandidates(
      candidatesByPath,
      extension.id,
      extension.extensionPath,
      packageJson,
      'runtime-extensions'
    );
  }

  scanAppExtensionsForProductIconThemes(candidatesByPath);
  const candidates = [...candidatesByPath.values()];
  productIconThemeCandidatesCache.set(cacheKey, candidates);
  return candidates;
}

function normalizeFontFormat(format: string): string | undefined {
  const normalized = format.trim().toLowerCase();
  if (normalized === 'woff2' || normalized === 'woff' || normalized === 'truetype' || normalized === 'opentype') {
    return normalized;
  }
  return undefined;
}

function detectFontMimeAndFormat(fontPath: string, explicitFormat?: string): { mime: string; format: string } | undefined {
  const normalizedExplicitFormat = explicitFormat ? normalizeFontFormat(explicitFormat) : undefined;
  if (normalizedExplicitFormat) {
    if (normalizedExplicitFormat === 'woff2') {
      return { mime: 'font/woff2', format: 'woff2' };
    }
    if (normalizedExplicitFormat === 'woff') {
      return { mime: 'font/woff', format: 'woff' };
    }
    if (normalizedExplicitFormat === 'truetype') {
      return { mime: 'font/ttf', format: 'truetype' };
    }
    if (normalizedExplicitFormat === 'opentype') {
      return { mime: 'font/otf', format: 'opentype' };
    }
  }

  const extension = path.extname(fontPath).toLowerCase();
  if (extension === '.woff2') {
    return { mime: 'font/woff2', format: 'woff2' };
  }
  if (extension === '.woff') {
    return { mime: 'font/woff', format: 'woff' };
  }
  if (extension === '.ttf') {
    return { mime: 'font/ttf', format: 'truetype' };
  }
  if (extension === '.otf') {
    return { mime: 'font/otf', format: 'opentype' };
  }
  return undefined;
}

function resolveRelativeAssetPath(baseFilePath: string, rawAssetPath: string): string | undefined {
  const rawPath = rawAssetPath.trim();
  if (!rawPath) {
    return undefined;
  }
  if (
    rawPath.startsWith('/') ||
    rawPath.startsWith('//') ||
    /^data:/i.test(rawPath) ||
    /^[a-z][a-z0-9+.-]*:/i.test(rawPath)
  ) {
    return undefined;
  }
  const pathWithoutHash = rawPath.split('#', 1)[0];
  const pathWithoutQuery = pathWithoutHash.split('?', 1)[0];
  if (!pathWithoutQuery) {
    return undefined;
  }
  const normalizedRelativePath = pathWithoutQuery.replace(/\\/g, '/');
  let decodedRelativePath = normalizedRelativePath;
  try {
    decodedRelativePath = decodeURIComponent(normalizedRelativePath);
  } catch {
    // 解码失败时返回 undefined (路径无效喵～)
    return undefined;
  }
  return path.resolve(path.dirname(baseFilePath), decodedRelativePath);
}

function extractCodiconFontFamilyChainFromWorkbenchCss(cssText: string): string[] {
  const ruleMatch = cssText.match(/\.codicon\[class\*=['"]?codicon-['"]?\]\{([^}]*)\}/i);
  if (!ruleMatch) {
    return [];
  }

  const ruleBody = ruleMatch[1] ?? '';
  let rawFontFamilies = '';

  const explicitFontFamilyMatch = ruleBody.match(/font-family\s*:\s*([^;]+)\s*;?/i);
  if (explicitFontFamilyMatch) {
    rawFontFamilies = explicitFontFamilyMatch[1] ?? '';
  } else {
    const shorthandMatch = ruleBody.match(/font\s*:\s*[^;]*?\/[^;]*?\s*([^;]+)\s*;?/i);
    rawFontFamilies = shorthandMatch?.[1] ?? '';
  }

  if (!rawFontFamilies.trim()) {
    return [];
  }

  const normalized = rawFontFamilies
    .split(',')
    .map((item) => normalizeFontFamilyToken(item))
    .filter((item) => /^[a-zA-Z0-9 _-]+$/.test(item));

  return [...new Set(normalized)];
}

function extractFontFaceSourceByFamily(cssText: string): Map<string, string> {
  const sources = new Map<string, string>();
  const fontFaceRegex = /@font-face\s*\{([^}]*)\}/gi;
  let match = fontFaceRegex.exec(cssText);
  while (match) {
    const block = match[1] ?? '';
    const familyMatch = block.match(/font-family\s*:\s*([^;]+)\s*;?/i);
    const sourceMatch = block.match(/src\s*:\s*url\(([^)]+)\)/i);
    if (familyMatch && sourceMatch) {
      const family = normalizeFontFamilyToken(familyMatch[1] ?? '');
      const source = (sourceMatch[1] ?? '').trim().replace(/^['"]|['"]$/g, '');
      if (family && source) {
        sources.set(family, source);
      }
    }
    match = fontFaceRegex.exec(cssText);
  }
  return sources;
}

function resolveDefaultHostFontPath(appRoot: string, fontFamily: string): string | undefined {
  const normalizedFamily = fontFamily.trim().toLowerCase();
  if (!normalizedFamily) {
    return undefined;
  }
  const candidateFile = path.join(appRoot, 'out', 'media', `${normalizedFamily}.ttf`);
  return fs.existsSync(candidateFile) ? candidateFile : undefined;
}

function buildHostWorkbenchCodiconOverrides(appRoot: string): HostCodiconOverrideResult {
  const workbenchCssPath = path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
  if (!fs.existsSync(workbenchCssPath)) {
    return {
      workbenchCssPath,
      configuredFontFamilyChain: [],
      injectedFontFamilies: [],
      cssText: ''
    };
  }

  let workbenchCss = '';
  try {
    workbenchCss = fs.readFileSync(workbenchCssPath, 'utf8');
  } catch {
    return {
      workbenchCssPath,
      configuredFontFamilyChain: [],
      injectedFontFamilies: [],
      cssText: ''
    };
  }

  const configuredFontFamilyChain = extractCodiconFontFamilyChainFromWorkbenchCss(workbenchCss);
  if (!configuredFontFamilyChain.length) {
    return {
      workbenchCssPath,
      configuredFontFamilyChain: [],
      injectedFontFamilies: [],
      cssText: ''
    };
  }

  const sourceByFamily = extractFontFaceSourceByFamily(workbenchCss);
  const cssChunks: string[] = [];
  const injectedFontFamilies: string[] = [];

  for (const fontFamily of configuredFontFamilyChain) {
    let fontAbsolutePath: string | undefined;
    const declaredSource = sourceByFamily.get(fontFamily);
    if (declaredSource) {
      fontAbsolutePath = resolveRelativeAssetPath(workbenchCssPath, declaredSource);
    }
    if (!fontAbsolutePath || !fs.existsSync(fontAbsolutePath)) {
      fontAbsolutePath = resolveDefaultHostFontPath(appRoot, fontFamily);
    }
    if (!fontAbsolutePath || !fs.existsSync(fontAbsolutePath)) {
      continue;
    }

    const detected = detectFontMimeAndFormat(fontAbsolutePath);
    if (!detected) {
      continue;
    }

    try {
      const base64 = fs.readFileSync(fontAbsolutePath).toString('base64');
      cssChunks.push(
        `@font-face{font-family:"${toCssStringLiteral(
          fontFamily
        )}";font-display:block;src:url("data:${detected.mime};base64,${base64}") format("${detected.format}");}`
      );
      injectedFontFamilies.push(fontFamily);
    } catch {
      continue;
    }
  }

  const fontFamilyChainCss = configuredFontFamilyChain
    .map((fontFamily) => `"${toCssStringLiteral(fontFamily)}"`)
    .join(',');
  cssChunks.push(`.codicon[class*='codicon-']{font-family:${fontFamilyChainCss} !important;}`);

  return {
    workbenchCssPath,
    configuredFontFamilyChain,
    injectedFontFamilies,
    cssText: cssChunks.join('\n')
  };
}

function resolveConfiguredProductIconTheme(): string | undefined {
  const config = vscode.workspace.getConfiguration('workbench');
  const inspected = config.inspect<string>('productIconTheme');
  const candidates: unknown[] = [
    inspected?.workspaceFolderValue,
    inspected?.workspaceValue,
    inspected?.globalValue,
    config.get<string>('productIconTheme'),
    inspected?.defaultValue
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function hasCodiconFontAssets(directoryPath: string): boolean {
  return CODICON_FONT_FILES.some((fileName) => fs.existsSync(path.join(directoryPath, fileName)));
}

// 优化：扩展跳过目录列表，避免扫描不必要的目录 (浮浮酱的优化喵～)
function shouldSkipDirectoryForCodiconScan(dirName: string): boolean {
  const normalized = dirName.toLowerCase();
  return (
    normalized === '.git' ||
    normalized === '.svn' ||
    normalized === '.hg' ||
    normalized === '__pycache__' ||
    normalized === 'node_modules' ||
    normalized === 'test' ||
    normalized === 'tests' ||
    normalized === 'docs' ||
    normalized === 'examples' ||
    normalized === 'coverage' ||
    normalized === '.vscode' ||
    normalized === '.idea'
  );
}

function readCodiconCssLength(directoryPath: string): number {
  try {
    const cssPath = path.join(directoryPath, 'codicon.css');
    return fs.readFileSync(cssPath, 'utf8').length;
  } catch {
    return 0;
  }
}

function scoreCodiconRoot(directoryPath: string, hasFonts: boolean, cssLength: number): number {
  const normalized = directoryPath.toLowerCase().replace(/\\/g, '/');
  let score = 0;
  if (hasFonts) {
    score += 20;
  }
  if (normalized.includes('/out/')) {
    score += 55;
  }
  if (normalized.includes('/codicons/')) {
    score += 45;
  }
  if (normalized.includes('/vs/base/browser/ui/codicons/')) {
    score += 35;
  }
  if (normalized.includes('/node_modules/@vscode/codicons/')) {
    score += 20;
  }
  if (normalized.includes('/extensions/simple-browser/')) {
    score += 25;
  }
  if (normalized.includes('/sign-in') || normalized.includes('/signin') || normalized.includes('/auth/')) {
    score -= 90;
  }
  if (cssLength > 0) {
    score += Math.min(Math.floor(cssLength / 3000), 40);
  }
  return score;
}

// 优化：简化扫描逻辑，提前退出 (浮浮酱的优化喵～)
function discoverCodiconRoots(appRoot: string): CodiconDiscoveredRoot[] {
  const discovered = new Map<string, CodiconDiscoveredRoot>();
  
  // 优先扫描最可能的目录
  const priorityDirs = [
    path.join(appRoot, 'out'),
    path.join(appRoot, 'node_modules'),
    path.join(appRoot, 'extensions')
  ];
  
  const queue: Array<{ dir: string; depth: number }> = priorityDirs
    .filter(dir => fs.existsSync(dir))
    .map(dir => ({ dir, depth: 0 }));
  
  let scannedDirs = 0;
  let foundHighQuality = false;

  while (queue.length > 0 && scannedDirs < CODICON_SCAN_MAX_DIRS && !foundHighQuality) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    scannedDirs += 1;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < CODICON_SCAN_MAX_DEPTH && !shouldSkipDirectoryForCodiconScan(entry.name)) {
          queue.push({ dir: fullPath, depth: current.depth + 1 });
        }
        continue;
      }

      if (!entry.isFile() || entry.name !== 'codicon.css') {
        continue;
      }
      const dirPath = path.dirname(fullPath);
      if (discovered.has(dirPath)) {
        continue;
      }
      const hasFonts = hasCodiconFontAssets(dirPath);
      const cssLength = readCodiconCssLength(dirPath);
      const score = scoreCodiconRoot(dirPath, hasFonts, cssLength);
      
      discovered.set(dirPath, {
        absolutePath: dirPath,
        hasFonts,
        cssLength,
        score
      });
      
      // 如果找到高质量的结果，标记退出 (快速路径喵～)
      if (score >= 100 && hasFonts) {
        foundHighQuality = true;
        break;
      }
      
      if (discovered.size >= CODICON_SCAN_MAX_RESULTS) {
        foundHighQuality = true;
        break;
      }
    }
  }

  return [...discovered.values()].sort((a, b) => b.score - a.score);
}

// 优化：优先使用预定义路径，减少文件系统扫描 (浮浮酱的优化喵～)
function pickBestCodiconRoot(appRoot: string): vscode.Uri {
  // 第一步：检查预定义的候选路径
  for (const relativeDir of CODICON_CANDIDATE_DIRS) {
    const absoluteDir = path.join(appRoot, relativeDir);
    const cssPath = path.join(absoluteDir, 'codicon.css');
    if (!fs.existsSync(cssPath)) {
      continue;
    }
    const hasFonts = hasCodiconFontAssets(absoluteDir);
    const cssLength = readCodiconCssLength(absoluteDir);
    const score = scoreCodiconRoot(absoluteDir, hasFonts, cssLength);
    
    // 如果找到高质量的候选路径，直接返回 (快速路径喵～)
    if (score >= 100 && hasFonts) {
      return vscode.Uri.file(absoluteDir);
    }
  }

  // 第二步：如果预定义路径都不理想，进行有限的扫描
  const candidateDiagnostics: Array<{ absolutePath: string; hasFonts: boolean; cssLength: number; score: number }> = [];

  for (const relativeDir of CODICON_CANDIDATE_DIRS) {
    const absoluteDir = path.join(appRoot, relativeDir);
    const cssPath = path.join(absoluteDir, 'codicon.css');
    if (!fs.existsSync(cssPath)) {
      continue;
    }
    const hasFonts = hasCodiconFontAssets(absoluteDir);
    const cssLength = readCodiconCssLength(absoluteDir);
    candidateDiagnostics.push({
      absolutePath: absoluteDir,
      hasFonts,
      cssLength,
      score: scoreCodiconRoot(absoluteDir, hasFonts, cssLength)
    });
  }

  // 只在必要时进行扫描 (减少性能开销喵～)
  const discovered = candidateDiagnostics.length === 0 ? discoverCodiconRoots(appRoot) : [];
  const all = [...candidateDiagnostics, ...discovered];
  
  if (!all.length) {
    return vscode.Uri.file(appRoot);
  }

  all.sort((a, b) => b.score - a.score);
  return vscode.Uri.file(all[0].absolutePath);
}

function inlineLocalFontUrls(rawCss: string, cssRootPath: string): string {
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  return rawCss.replace(urlPattern, (full, _quote: string, urlValue: string) => {
    const rawPath = String(urlValue || '').trim();
    if (!rawPath) {
      return full;
    }
    if (
      rawPath.startsWith('/') ||
      rawPath.startsWith('//') ||
      /^data:/i.test(rawPath) ||
      /^[a-z][a-z0-9+.-]*:/i.test(rawPath)
    ) {
      return full;
    }

    const pathWithoutHash = rawPath.split('#', 1)[0];
    const pathWithoutQuery = pathWithoutHash.split('?', 1)[0];
    const normalizedRelativePath = pathWithoutQuery.replace(/\\/g, '/');
    let decodedRelativePath = normalizedRelativePath;
    try {
      decodedRelativePath = decodeURIComponent(normalizedRelativePath);
    } catch {
      // keep raw path when decode fails
    }
    const resolvedPath = path.resolve(cssRootPath, decodedRelativePath);
    if (!fs.existsSync(resolvedPath)) {
      return full;
    }

    const detected = detectFontMimeAndFormat(resolvedPath);
    if (!detected) {
      return full;
    }

    try {
      const base64 = fs.readFileSync(resolvedPath).toString('base64');
      return `url("data:${detected.mime};base64,${base64}")`;
    } catch {
      return full;
    }
  });
}

function scoreThemeCandidate(target: string, candidate: ProductIconThemeCandidate): number {
  const normalizedTarget = normalizeThemeToken(target);
  const normalizedId = normalizeThemeToken(candidate.id);
  const normalizedLabel = normalizeThemeToken(candidate.label);
  let score = 0;

  if (normalizedTarget && normalizedId && normalizedId === normalizedTarget) {
    score = Math.max(score, 120);
  }
  if (normalizedTarget && normalizedLabel && normalizedLabel === normalizedTarget) {
    score = Math.max(score, 110);
  }
  if (normalizedTarget && normalizedId && normalizedId.includes(normalizedTarget)) {
    score = Math.max(score, 90);
  }
  if (normalizedTarget && normalizedLabel && normalizedLabel.includes(normalizedTarget)) {
    score = Math.max(score, 80);
  }

  if (normalizedTarget === 'default' || normalizedTarget === '默认') {
    if (normalizedLabel.includes('default') || normalizedLabel.includes('默认')) {
      score = Math.max(score, 75);
    }
    if (normalizedId.includes('default') || normalizedId === 'vs-seti') {
      score = Math.max(score, 70);
    }
    if (candidate.extensionId.toLowerCase().includes('theme-default')) {
      score = Math.max(score, 65);
    }
  }

  return score;
}

function resolveActiveProductIconThemeCandidate(): ProductIconThemeCandidate | undefined {
  try {
    const configuredTheme = resolveConfiguredProductIconTheme();
    if (!configuredTheme) {
      return undefined;
    }
    const candidates = collectProductIconThemeCandidates().filter((item) => fs.existsSync(item.resolvedPath));
    if (!candidates.length) {
      return undefined;
    }

    let best: { score: number; candidate: ProductIconThemeCandidate } | undefined;
    for (const candidate of candidates) {
      const score = scoreThemeCandidate(configuredTheme, candidate);
      if (!best || score > best.score) {
        best = { score, candidate };
      }
    }

    if (best && best.score > 0) {
      return best.candidate;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function resolveActiveProductIconThemePath(): string | undefined {
  return resolveActiveProductIconThemeCandidate()?.resolvedPath;
}

function buildProductIconThemeOverrides(): string {
  const themeFilePath = resolveActiveProductIconThemePath();
  if (!themeFilePath) {
    return '';
  }

  let parsed: ProductIconThemeFile | undefined;
  try {
    const rawThemeContent = fs.readFileSync(themeFilePath, 'utf8');
    parsed = parseJsonLike<ProductIconThemeFile>(rawThemeContent);
  } catch {
    return '';
  }
  if (!parsed) {
    return '';
  }

  const cssChunks: string[] = [];
  const fontFamilyById = new Map<string, string>();
  let defaultFontFamily = 'codicon';
  let resolvedAnyThemeFont = false;

  if (Array.isArray(parsed.fonts)) {
    for (const rawFont of parsed.fonts) {
      const font = rawFont as ProductIconThemeFont;
      if (typeof font.id !== 'string' || !font.id.trim()) {
        continue;
      }
      if (!Array.isArray(font.src) || font.src.length === 0) {
        continue;
      }

      const sourceEntries: string[] = [];
      for (const rawSource of font.src) {
        const source = rawSource as ProductIconThemeSource;
        if (typeof source.path !== 'string' || !source.path.trim()) {
          continue;
        }
        const absoluteFontPath = path.resolve(path.dirname(themeFilePath), source.path);
        if (!fs.existsSync(absoluteFontPath)) {
          continue;
        }
        const detected = detectFontMimeAndFormat(
          absoluteFontPath,
          typeof source.format === 'string' ? source.format : undefined
        );
        if (!detected) {
          continue;
        }
        try {
          const fontBase64 = fs.readFileSync(absoluteFontPath).toString('base64');
          sourceEntries.push(`url("data:${detected.mime};base64,${fontBase64}") format("${detected.format}")`);
        } catch {
          continue;
        }
      }

      if (!sourceEntries.length) {
        continue;
      }

      const sanitizedFontId = font.id.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
      const family = `chatbuddy-product-icon-${sanitizedFontId}`;
      fontFamilyById.set(font.id.trim(), family);
      if (!resolvedAnyThemeFont) {
        defaultFontFamily = family;
        resolvedAnyThemeFont = true;
      }

      const style = normalizeCssToken(font.style, 'normal');
      const weight = normalizeCssToken(font.weight, 'normal');

      cssChunks.push(
        `@font-face{font-family:"${family}";font-style:${toCssStringLiteral(style)};font-weight:${toCssStringLiteral(weight)};font-display:block;src:${sourceEntries.join(',')};}`
      );
    }
  }

  if (!parsed.iconDefinitions || typeof parsed.iconDefinitions !== 'object') {
    return cssChunks.join('\n');
  }

  for (const [iconId, rawDefinition] of Object.entries(parsed.iconDefinitions as Record<string, unknown>)) {
    if (!/^[a-z0-9-]+$/i.test(iconId)) {
      continue;
    }
    const definition = rawDefinition as ProductIconDefinition;
    if (typeof definition.fontCharacter !== 'string' || !definition.fontCharacter) {
      continue;
    }

    const desiredFontId =
      typeof definition.fontId === 'string' && definition.fontId.trim() ? definition.fontId.trim() : undefined;
    const fontFamily = (desiredFontId && fontFamilyById.get(desiredFontId)) || defaultFontFamily;
    cssChunks.push(
      `.codicon.codicon-${iconId}:before{content:"${toCssContentLiteral(
        definition.fontCharacter
      )}" !important;font-family:"${toCssStringLiteral(fontFamily)}" !important;}`
    );
  }

  return cssChunks.join('\n');
}

function safeBuildProductIconThemeOverrides(): string {
  try {
    return buildProductIconThemeOverrides();
  } catch {
    return '';
  }
}

/**
 * 获取 Codicon 图标库的根目录 URI
 * 使用缓存机制避免重复扫描文件系统
 * @returns Codicon 根目录的 URI
 */
export function getCodiconRootUri(): vscode.Uri {
  const appRoot = vscode.env.appRoot;
  const cached = codiconRootCache.get(appRoot);
  if (cached) {
    return cached;
  }
  const resolved = pickBestCodiconRoot(appRoot);
  codiconRootCache.set(appRoot, resolved);
  return resolved;
}

/**
 * 获取 Codicon 样式文本，包含内联的字体文件和主题覆盖
 * 该函数会：
 * 1. 读取 codicon.css 文件
 * 2. 内联本地字体文件为 base64 data URI
 * 3. 应用产品图标主题覆盖
 * 4. 应用宿主工作台覆盖
 * @returns 完整的 CSS 样式文本
 */
export function getCodiconStyleText(): string {
  const appRoot = vscode.env.appRoot;
  const codiconRoot = getCodiconRootUri();
  const cssPath = path.join(codiconRoot.fsPath, 'codicon.css');
  let rawCss = '';
  try {
    rawCss = fs.readFileSync(cssPath, 'utf8');
  } catch {
    return '';
  }

  const inlinedCss = inlineLocalFontUrls(rawCss, codiconRoot.fsPath);
  const productThemeOverrides = safeBuildProductIconThemeOverrides();
  const hostOverrides = buildHostWorkbenchCodiconOverrides(appRoot);
  const parts = [inlinedCss];
  if (productThemeOverrides) {
    parts.push(productThemeOverrides);
  }
  if (hostOverrides.cssText) {
    parts.push(hostOverrides.cssText);
  }
  return parts.join('\n');
}
