import * as vscode from 'vscode';
import { resolveLocale } from '../i18n';
import { ChatBuddySettings, RuntimeLocale, RuntimeStrings, ChatSendShortcut, ChatTabMode } from '../types';

/**
 * 根据设置获取当前运行时语言
 * @param settings 应用设置
 */
export function getLocaleFromSettings(settings: ChatBuddySettings): RuntimeLocale {
  return resolveLocale(settings.locale, vscode.env.language);
}

/**
 * 根据语言返回对应的文本
 * @param locale 当前语言
 * @param zhText 中文文本
 * @param enText 英文文本
 * @returns 对应语言的文本
 */
export function resolveLocaleString(locale: string, zhText: string, enText: string): string {
  return locale === 'zh-CN' ? zhText : enText;
}

/**
 * 获取发送快捷键选项
 * @param strings 本地化字符串
 */
export function getSendShortcutOptions(strings: RuntimeStrings): ReadonlyArray<{ value: ChatSendShortcut; label: string }> {
  return [
    { value: 'enter', label: strings.sendShortcutEnter },
    { value: 'ctrlEnter', label: strings.sendShortcutCtrlEnter }
  ] as const;
}

/**
 * 获取聊天标签页模式选项
 * @param strings 本地化字符串
 */
export function getChatTabModeOptions(strings: RuntimeStrings): ReadonlyArray<{ value: ChatTabMode; label: string }> {
  return [
    { value: 'single', label: strings.chatTabModeSingle },
    { value: 'multi', label: strings.chatTabModeMulti }
  ] as const;
}
