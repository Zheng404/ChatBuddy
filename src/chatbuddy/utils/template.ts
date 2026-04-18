import * as vscode from 'vscode';

/**
 * Resolve template variables in a string.
 * Supports: {{currentFile}}, {{selection}}, {{language}}, {{fileName}}, {{fileDir}},
 *           {{lineNumber}}, {{lineCount}}, {{activeEditorLanguage}}
 */
const TEMPLATE_VAR_PATTERN = /\{\{(\w+)\}\}/g;

function getActiveEditorInfo(): {
  filePath: string;
  fileName: string;
  fileDir: string;
  selection: string;
  language: string;
  lineNumber: string;
  lineCount: string;
} {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return { filePath: '', fileName: '', fileDir: '', selection: '', language: '', lineNumber: '', lineCount: '' };
  }
  const doc = editor.document;
  const sel = editor.selection;
  const filePath = doc.uri.fsPath;
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return {
    filePath,
    fileName: lastSep >= 0 ? filePath.slice(lastSep + 1) : filePath,
    fileDir: lastSep >= 0 ? filePath.slice(0, lastSep) : '',
    selection: doc.getText(sel),
    language: doc.languageId,
    lineNumber: String(sel.active.line + 1),
    lineCount: String(doc.lineCount)
  };
}

export function resolveTemplateVariables(input: string): string {
  if (!input || !TEMPLATE_VAR_PATTERN.test(input)) {
    return input;
  }
  TEMPLATE_VAR_PATTERN.lastIndex = 0;
  const info = getActiveEditorInfo();
  return input.replace(TEMPLATE_VAR_PATTERN, (match, key: string) => {
    switch (key) {
      case 'currentFile': return info.filePath;
      case 'fileName': return info.fileName;
      case 'fileDir': return info.fileDir;
      case 'selection': return info.selection;
      case 'language': return info.language;
      case 'activeEditorLanguage': return info.language;
      case 'lineNumber': return info.lineNumber;
      case 'lineCount': return info.lineCount;
      default: return match;
    }
  });
}
