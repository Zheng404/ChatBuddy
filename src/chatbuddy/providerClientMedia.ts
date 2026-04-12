type MediaKind = 'image' | 'video';

type MediaSourceConfig = {
  defaultDataMime: string;
  directKeys: readonly string[];
  nestedKeys: readonly string[];
  encodedKeys: ReadonlyArray<{ key: string; appendKind?: boolean }>;
};

const HTTP_URL_RE = /^https?:\/\/\S+$/i;
const DATA_IMAGE_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;
const DATA_VIDEO_URL_RE = /^data:video\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i;
const BASE64_RE = /^[a-z0-9+/]+=*$/i;
const WHITESPACE_RE = /\s+/g;
const MEDIA_SOURCE_MAX_DEPTH = 4;

const MEDIA_SOURCE_CONFIG: Record<MediaKind, MediaSourceConfig> = {
  image: {
    defaultDataMime: 'image/png',
    directKeys: ['url', 'image_url', 'imageUrl', 'image'],
    nestedKeys: ['content', 'output', 'item', 'items', 'response', 'images'],
    encodedKeys: [
      { key: 'b64_json', appendKind: true },
      { key: 'base64', appendKind: true },
      { key: 'data', appendKind: true },
      { key: 'result' }
    ]
  },
  video: {
    defaultDataMime: 'video/mp4',
    directKeys: ['url', 'video_url', 'videoUrl', 'video'],
    nestedKeys: ['content', 'output', 'item', 'items', 'response', 'videos'],
    encodedKeys: [
      { key: 'b64_json', appendKind: true },
      { key: 'base64', appendKind: true },
      { key: 'data', appendKind: true },
      { key: 'result' }
    ]
  }
};

export function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function toObject<T extends Record<string, unknown>>(value: unknown): T | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
}

function isHttpUrl(value: string): boolean {
  return HTTP_URL_RE.test(value);
}

function isDataImageUrl(value: string): boolean {
  return DATA_IMAGE_URL_RE.test(value);
}

function isDataVideoUrl(value: string): boolean {
  return DATA_VIDEO_URL_RE.test(value);
}

function looksLikeBase64(value: string): boolean {
  const normalized = value.replace(WHITESPACE_RE, '');
  if (normalized.length < 64 || normalized.length % 4 !== 0) {
    return false;
  }
  return BASE64_RE.test(normalized);
}

function toMediaSource(value: unknown, mediaKind: MediaKind, typeHint = '', depth = 0): string | undefined {
  if (depth > MEDIA_SOURCE_MAX_DEPTH) {
    return undefined;
  }
  const config = MEDIA_SOURCE_CONFIG[mediaKind];
  const normalizedHint = typeHint.toLowerCase();
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (!candidate) {
      return undefined;
    }
    const isDataUrl = mediaKind === 'image' ? isDataImageUrl(candidate) : isDataVideoUrl(candidate);
    if (isHttpUrl(candidate) || isDataUrl) {
      return candidate;
    }
    if (normalizedHint.includes(mediaKind) && looksLikeBase64(candidate)) {
      return `data:${config.defaultDataMime};base64,${candidate.replace(WHITESPACE_RE, '')}`;
    }
    return undefined;
  }

  const payload = toObject<Record<string, unknown>>(value);
  if (!payload) {
    return undefined;
  }

  const nextHint = `${normalizedHint} ${toTrimmedString(payload.type).toLowerCase()} ${toTrimmedString(payload.kind).toLowerCase()}`.trim();

  for (const key of config.directKeys) {
    const source = toMediaSource(payload[key], mediaKind, nextHint, depth + 1);
    if (source) {
      return source;
    }
  }

  for (const { key, appendKind } of config.encodedKeys) {
    const hint = appendKind ? `${nextHint} ${mediaKind}`.trim() : nextHint;
    const source = toMediaSource(payload[key], mediaKind, hint, depth + 1);
    if (source) {
      return source;
    }
  }

  for (const key of config.nestedKeys) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const source = toMediaSource(item, mediaKind, nextHint, depth + 1);
        if (source) {
          return source;
        }
      }
      continue;
    }
    const source = toMediaSource(candidate, mediaKind, nextHint, depth + 1);
    if (source) {
      return source;
    }
  }

  return undefined;
}

function toImageSource(value: unknown, typeHint = '', depth = 0): string | undefined {
  return toMediaSource(value, 'image', typeHint, depth);
}

function toVideoSource(value: unknown, typeHint = '', depth = 0): string | undefined {
  return toMediaSource(value, 'video', typeHint, depth);
}

export function toImageMarkdown(value: unknown, typeHint = ''): string | undefined {
  const source = toImageSource(value, typeHint.toLowerCase());
  if (!source) {
    return undefined;
  }
  return `![image](${source})`;
}

export function toVideoMarkdown(value: unknown, typeHint = ''): string | undefined {
  const source = toVideoSource(value, typeHint.toLowerCase());
  if (!source) {
    return undefined;
  }
  return `![video](${source})`;
}

export function appendChunk(chunks: string[], value: unknown): void {
  const text = toTrimmedString(value);
  if (text) {
    chunks.push(text);
  }
}

export function joinChunks(chunks: string[]): string | undefined {
  const text = chunks.map((item) => item.trim()).filter(Boolean).join('\n').trim();
  return text || undefined;
}
