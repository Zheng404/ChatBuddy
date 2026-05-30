import test from 'node:test';
import { benchmark } from './perf';
import { escapeHtml, escapeHtmlAttr } from '../../chatbuddy/utils/html';
import { buildPreview } from '../../chatbuddy/compassStorage/types';
import { makeMessage } from '../fixtures';

test('benchmark: escapeHtml — short text', () => {
  const input = 'Hello <world> & "everyone"';
  benchmark('escapeHtml (short)', () => {
    escapeHtml(input);
  }, 10000);
});

test('benchmark: escapeHtml — long text', () => {
  const input = 'Hello <world> & "everyone"'.repeat(100);
  benchmark('escapeHtml (long)', () => {
    escapeHtml(input);
  }, 10000);
});

test('benchmark: escapeHtmlAttr', () => {
  const input = 'value\nwith\rnewlines & <tags>';
  benchmark('escapeHtmlAttr', () => {
    escapeHtmlAttr(input);
  }, 10000);
});

test('benchmark: buildPreview — few messages', () => {
  const messages = [
    makeMessage({ role: 'user', content: 'First message here' }),
    makeMessage({ role: 'assistant', content: 'Second message here' }),
    makeMessage({ role: 'user', content: 'Third message here' }),
  ];
  benchmark('buildPreview (few messages)', () => {
    buildPreview(messages);
  }, 10000);
});

test('benchmark: buildPreview — many messages', () => {
  const messages: ReturnType<typeof makeMessage>[] = [];
  for (let i = 0; i < 100; i++) {
    messages.push(makeMessage({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message number ${i} with some content here` }));
  }
  benchmark('buildPreview (many messages)', () => {
    buildPreview(messages);
  }, 10000);
});

test('benchmark: buildPreview — empty messages', () => {
  const messages = [
    makeMessage({ role: 'user', content: '' }),
    makeMessage({ role: 'assistant', content: '' }),
    makeMessage({ role: 'user', content: '' }),
  ];
  benchmark('buildPreview (empty messages)', () => {
    buildPreview(messages);
  }, 10000);
});
