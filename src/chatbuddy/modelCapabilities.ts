/**
 * 模型能力推断模块。
 *
 * 三层推断策略：API 响应（运行时） > 内置注册表（已知模型） > 正则模式（模糊匹配）。
 * 自动解析模型类型（chat/image/video/audio/embedding/rerank）和功能能力（vision/reasoning/tools/webSearch）。
 */
import { ModelCapabilities, ModelKind } from './types';
import { resolveFromRegistry } from './modelCapabilityRegistry';
import { resolveFromPatterns } from './modelCapabilityPatterns';

export function hasAnyCapability(caps: ModelCapabilities | undefined): boolean {
  if (!caps) {
    return false;
  }
  return !!(caps.vision || caps.reasoning || caps.tools || caps.webSearch);
}

/**
 * Resolve capabilities using priority: API → Registry → Regex patterns.
 * Returns undefined only if no source provides any capability.
 */
export function resolveCapabilities(
  modelId: string,
  apiCaps?: ModelCapabilities
): ModelCapabilities | undefined {
  // 1. API response takes priority
  if (apiCaps && hasAnyCapability(apiCaps)) {
    return apiCaps;
  }
  // 2. Hardcoded registry
  const reg = resolveFromRegistry(modelId);
  if (reg?.capabilities) {
    return reg.capabilities;
  }
  // 3. Regex patterns
  const pat = resolveFromPatterns(modelId);
  return pat?.capabilities;
}

/**
 * Resolve model kind using priority: API → Registry → Regex patterns.
 * Defaults to 'chat' if nothing matches.
 */
export function resolveKind(
  modelId: string,
  apiKind?: ModelKind
): ModelKind {
  if (apiKind) {
    return apiKind;
  }
  const reg = resolveFromRegistry(modelId);
  if (reg?.kind) {
    return reg.kind;
  }
  const pat = resolveFromPatterns(modelId);
  return pat?.kind || 'chat';
}
