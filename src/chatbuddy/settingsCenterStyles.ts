/**
 * 设置中心样式聚合入口。
 *
 * 按功能区域拆分为多个模块，通过此入口统一组合：
 * - settingsCenterBaseCss.ts    — 基础布局、导航、通用组件、Toast、响应式
 * - settingsCenterAboutCss.ts   — About 页面专属样式
 * - settingsCenterProviderCss.ts — Provider 工作区、模型管理、Capability pills
 * - settingsCenterModalCss.ts   — Modal 弹窗、Fetch Models
 * - settingsCenterMcpCss.ts     — MCP 服务器管理
 */
import { getSettingsCenterBaseCss } from './settingsCenterBaseCss';
import { getSettingsCenterAboutCss } from './settingsCenterAboutCss';
import { getSettingsCenterProviderCss } from './settingsCenterProviderCss';
import { getSettingsCenterModalCss } from './settingsCenterModalCss';
import { getSettingsCenterMcpCss } from './settingsCenterMcpCss';

export function getSettingsCenterCss(): string {
  return `
      ${getSettingsCenterBaseCss()}
      ${getSettingsCenterAboutCss()}
      ${getSettingsCenterProviderCss()}
      ${getSettingsCenterModalCss()}
      ${getSettingsCenterMcpCss()}
  `;
}
