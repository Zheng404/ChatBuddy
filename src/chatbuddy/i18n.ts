import { AssistantProfile, ChatBuddyLocaleSetting, RuntimeLocale, RuntimeStrings } from './types';
import { RUNTIME_STRINGS } from './i18n/runtimeStrings';

type AssistantLocalization = {
  name: string;
  subtitle: string;
  systemPrompt: string;
};

export function normalizeLocale(vscodeLanguage: string): RuntimeLocale {
  return vscodeLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function resolveLocale(setting: ChatBuddyLocaleSetting | undefined, vscodeLanguage: string): RuntimeLocale {
  if (setting === 'zh-CN' || setting === 'en') {
    return setting;
  }
  return normalizeLocale(vscodeLanguage);
}

export function getStrings(locale: RuntimeLocale): RuntimeStrings {
  return RUNTIME_STRINGS[locale];
}

export function formatString(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

export function getDefaultSessionTitle(locale: RuntimeLocale): string {
  return getStrings(locale).untitledSession;
}

export function getAssistantLocalization(_locale: RuntimeLocale, assistant: AssistantProfile): AssistantLocalization {
  return {
    name: assistant.name,
    subtitle: assistant.note || '',
    systemPrompt: assistant.systemPrompt
  };
}

export function getLanguageOptions(strings: RuntimeStrings) {
  return [
    { value: 'auto', label: strings.languageAuto },
    { value: 'zh-CN', label: strings.languageZhCn },
    { value: 'en', label: strings.languageEn }
  ] as const;
}
