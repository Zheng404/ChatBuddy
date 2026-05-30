/**
 * 文件上下文引用功能单元测试。
 *
 * 覆盖文件内容格式化、ChatMessage files 字段兼容性、
 * 以及 toProviderConversationMessages 对 files 的处理。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatMessage, ChatMessageFile } from '../../../chatbuddy/types';
import { toProviderConversationMessages } from '../../../chatbuddy/chatUtils';

function makeFile(name: string, content: string, language?: string): ChatMessageFile {
  return { name, content, language };
}

function makeUserMessage(content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-test',
    role: 'user',
    content,
    timestamp: Date.now(),
    ...overrides
  };
}

describe('file context formatting', () => {
  test('formats single file as markdown code block', () => {
    const file = makeFile('helper.ts', 'export function helper() { return 42; }', 'typescript');
    const prefix = '';
    const fileBlocks = file.language
      ? '```' + file.language + '\n// File: ' + file.name + '\n' + file.content + '\n```'
      : '```\n// File: ' + file.name + '\n' + file.content + '\n```';
    const fullContent = prefix ? prefix + '\n\n' + fileBlocks : fileBlocks;
    assert.equal(fullContent, '```typescript\n// File: helper.ts\nexport function helper() { return 42; }\n```');
  });

  test('formats multiple files as separate code blocks', () => {
    const files = [
      makeFile('a.ts', 'const a = 1;', 'typescript'),
      makeFile('b.css', 'body { color: red; }', 'css')
    ];
    const blocks = files.map(f => '```' + (f.language || '') + '\n// File: ' + f.name + '\n' + f.content + '\n```');
    const fullContent = 'Hello\n\n' + blocks.join('\n\n');
    assert.ok(fullContent.includes('```typescript\n// File: a.ts\nconst a = 1;\n```'));
    assert.ok(fullContent.includes('```css\n// File: b.css\nbody { color: red; }\n```'));
  });

  test('formats only files without user text', () => {
    const files = [makeFile('config.json', '{"key": "value"}', 'json')];
    const blocks = files.map(f => '```' + (f.language || '') + '\n// File: ' + f.name + '\n' + f.content + '\n```');
    const fullContent = blocks.join('\n\n');
    assert.equal(fullContent, '```json\n// File: config.json\n{"key": "value"}\n```');
  });

  test('handles file without language', () => {
    const file = makeFile('Makefile', 'all:\n\techo hello');
    const block = '```' + (file.language || '') + '\n// File: ' + file.name + '\n' + file.content + '\n```';
    assert.equal(block, '```\n// File: Makefile\nall:\n\techo hello\n```');
  });

  test('preserves file metadata in ChatMessage', () => {
    const files = [makeFile('test.ts', 'const x = 1;', 'typescript')];
    const msg: ChatMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'user question\n\n```typescript\n// File: test.ts\nconst x = 1;\n```',
      timestamp: 12345,
      files
    };
    assert.equal(msg.files?.length, 1);
    assert.equal(msg.files?.[0].name, 'test.ts');
    assert.equal(msg.files?.[0].content, 'const x = 1;');
    assert.equal(msg.files?.[0].language, 'typescript');
  });
});

describe('toProviderConversationMessages with files', () => {
  test('converts message with files to provider format', () => {
    const messages: ChatMessage[] = [
      makeUserMessage('Explain this code\n\n```typescript\n// File: main.ts\nconsole.log(1);\n```', {
        files: [makeFile('main.ts', 'console.log(1);', 'typescript')]
      })
    ];
    const result = toProviderConversationMessages('', messages);
    assert.equal(result.length, 1);
    assert.equal(result[0].role, 'user');
    assert.equal(typeof result[0].content, 'string');
    const content = result[0].content as string;
    assert.ok(content.includes('Explain this code'));
    assert.ok(content.includes('```typescript'));
    assert.ok(content.includes('// File: main.ts'));
    assert.ok(content.includes('console.log(1);'));
  });

  test('converts message with files and images to provider format', () => {
    const messages: ChatMessage[] = [
      makeUserMessage('Compare this', {
        images: [{ base64: 'abc123', mimeType: 'image/png' }],
        files: [makeFile('a.ts', 'const x = 1;', 'typescript')]
      })
    ];
    const result = toProviderConversationMessages('', messages);
    assert.equal(result.length, 1);
    assert.equal(result[0].role, 'user');
    assert.ok(Array.isArray(result[0].content));
    const parts = result[0].content as Array<{ type: string }>;
    assert.equal(parts.length, 2);
    assert.equal(parts[0].type, 'text');
    assert.equal(parts[1].type, 'image_url');
    const textPart = parts[0] as { type: 'text'; text: string };
    assert.ok(textPart.text.includes('Compare this'));
    assert.ok(textPart.text.includes('// File: a.ts'));
  });

  test('skips empty content messages without files or images', () => {
    const messages: ChatMessage[] = [
      makeUserMessage(''), // 应该被跳过
      makeUserMessage('', { files: [makeFile('a.ts', 'const x = 1;')] }) // 应该保留（files 元数据存在）
    ];
    const result = toProviderConversationMessages('', messages);
    assert.equal(result.length, 1);
    // files 元数据存在，函数会自动拼接文件内容到 provider message
    assert.ok(typeof result[0].content === 'string');
    assert.ok((result[0].content as string).includes('// File: a.ts'));
  });
});
