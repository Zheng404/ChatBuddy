import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTemplateVariables } from '../../../chatbuddy/utils/template';

// ─── Tests ───────────────────────────────────────────────────────────────────
// Note: The vscode mock in setup.ts provides vscode.window.activeTextEditor = undefined.
// When no editor is active, all template variables resolve to empty strings.

test('resolveTemplateVariables - returns empty string as-is', () => {
  assert.equal(resolveTemplateVariables(''), '');
});

test('resolveTemplateVariables - returns input without template variables as-is', () => {
  assert.equal(resolveTemplateVariables('Hello World'), 'Hello World');
  assert.equal(resolveTemplateVariables('No variables here!'), 'No variables here!');
});

test('resolveTemplateVariables - returns plain text with special characters as-is', () => {
  assert.equal(resolveTemplateVariables('Price: $100 (20% off)'), 'Price: $100 (20% off)');
  assert.equal(resolveTemplateVariables('Text with { and }'), 'Text with { and }');
});

test('resolveTemplateVariables - resolves known variable currentFile to empty (no active editor)', () => {
  // No active editor → all variables resolve to empty string
  assert.equal(resolveTemplateVariables('{{currentFile}}'), '');
});

test('resolveTemplateVariables - resolves known variable fileName to empty (no active editor)', () => {
  assert.equal(resolveTemplateVariables('{{fileName}}'), '');
});

test('resolveTemplateVariables - resolves known variable fileDir to empty (no active editor)', () => {
  assert.equal(resolveTemplateVariables('{{fileDir}}'), '');
});

test('resolveTemplateVariables - resolves known variable selection to empty (no active editor)', () => {
  assert.equal(resolveTemplateVariables('{{selection}}'), '');
});

test('resolveTemplateVariables - resolves known variable language to empty (no active editor)', () => {
  assert.equal(resolveTemplateVariables('{{language}}'), '');
});

test('resolveTemplateVariables - resolves known variable activeEditorLanguage to empty (no active editor)', () => {
  assert.equal(resolveTemplateVariables('{{activeEditorLanguage}}'), '');
});

test('resolveTemplateVariables - resolves known variable lineNumber to empty (no active editor)', () => {
  assert.equal(resolveTemplateVariables('{{lineNumber}}'), '');
});

test('resolveTemplateVariables - resolves known variable lineCount to empty (no active editor)', () => {
  assert.equal(resolveTemplateVariables('{{lineCount}}'), '');
});

test('resolveTemplateVariables - preserves unknown variables unchanged', () => {
  assert.equal(resolveTemplateVariables('{{unknownVar}}'), '{{unknownVar}}');
  assert.equal(resolveTemplateVariables('{{foo}}'), '{{foo}}');
  assert.equal(resolveTemplateVariables('{{123}}'), '{{123}}');
});

test('resolveTemplateVariables - handles mixed known and unknown variables', () => {
  // Known variables resolve to empty, unknown preserved
  const result = resolveTemplateVariables('File: {{currentFile}}, Env: {{unknownEnv}}');
  assert.equal(result, 'File: , Env: {{unknownEnv}}');
});

test('resolveTemplateVariables - handles multiple known variables in one string', () => {
  const result = resolveTemplateVariables('{{fileName}} in {{fileDir}} ({{language}})');
  assert.equal(result, ' in  ()');
});

test('resolveTemplateVariables - handles repeated variables', () => {
  const result = resolveTemplateVariables('{{language}} and {{language}}');
  assert.equal(result, ' and ');
});

test('resolveTemplateVariables - handles variable adjacent to text', () => {
  assert.equal(resolveTemplateVariables('File:{{currentFile}}'), 'File:');
  assert.equal(resolveTemplateVariables('{{currentFile}}.ts'), '.ts');
  assert.equal(resolveTemplateVariables('a{{language}}b'), 'ab');
});

test('resolveTemplateVariables - handles multiline input', () => {
  const input = 'Line 1: {{fileName}}\nLine 2: {{language}}';
  const result = resolveTemplateVariables(input);
  assert.equal(result, 'Line 1: \nLine 2: ');
});
