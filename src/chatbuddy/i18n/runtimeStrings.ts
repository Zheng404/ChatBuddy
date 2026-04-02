import { RuntimeLocale, RuntimeStrings } from '../types';
import { EN_RUNTIME_STRINGS } from './strings.en';
import { ZH_CN_RUNTIME_STRINGS } from './strings.zh-CN';

export const RUNTIME_STRINGS: Record<RuntimeLocale, RuntimeStrings> = {
  'zh-CN': ZH_CN_RUNTIME_STRINGS,
  en: EN_RUNTIME_STRINGS
};
