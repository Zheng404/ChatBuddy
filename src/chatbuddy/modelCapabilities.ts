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
