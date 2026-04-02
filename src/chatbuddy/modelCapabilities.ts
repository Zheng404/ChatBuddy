import { ModelCapabilities } from './types';

export function hasAnyCapability(caps: ModelCapabilities | undefined): boolean {
  if (!caps) {
    return false;
  }
  return !!(caps.vision || caps.reasoning || caps.audio || caps.video || caps.tools);
}
