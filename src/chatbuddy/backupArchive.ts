import { inflateRawSync } from 'zlib';

import {
  COMPASS_LAYOUT_VERSION,
  COMPASS_INDEX_FILE_NAME,
  COMPASS_KV_FILE_NAME,
  COMPASS_META_DIR_NAME,
  COMPASS_SESSIONS_DIR_NAME,
  STRUCTURED_PROVIDER_API_KEYS_FILE_NAME,
  STRUCTURED_SETTINGS_DEFAULT_MODELS_FILE_NAME,
  STRUCTURED_SETTINGS_GENERAL_FILE_NAME,
  STRUCTURED_SETTINGS_MCP_FILE_NAME,
  STRUCTURED_SETTINGS_MODEL_CONFIG_FILE_NAME,
  STRUCTURED_STATE_CORE_FILE_NAME,
  STRUCTURED_UI_SELECTION_FILE_NAME
} from './compassStorage/paths';
import { buildPreview, normalizeSummary, type CompassIndexFile } from './compassStorage/types';
import type { ChatBuddyBackupData, ChatBuddyBackupStorageData } from './stateRepository';
import type { ChatMessage, ChatSessionDetail } from './types';

export const BACKUP_ARCHIVE_MANIFEST_PATH = 'backup.manifest.json';
const BACKUP_ARCHIVE_PACKAGE_FORMAT = 'structured-zip';
const SUPPORTED_BACKUP_SCHEMA: ChatBuddyBackupData['schema'] = 'chatbuddy.backup.compass';
const SUPPORTED_BACKUP_VERSION: ChatBuddyBackupData['version'] = 2;

type ZipEntry = {
  path: string;
  data: Uint8Array;
};

type BackupArchiveManifest = Pick<ChatBuddyBackupData, 'schema' | 'version' | 'exportedAt'> & {
  packageFormat: typeof BACKUP_ARCHIVE_PACKAGE_FORMAT;
  storage: Pick<ChatBuddyBackupStorageData, 'layout' | 'layoutVersion'>;
};

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DEFLATE_METHOD = 8;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(input: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of input) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function toJsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTrimmedStringMap(input: unknown): Record<string, string> {
  if (!isRecord(input)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string') {
      continue;
    }
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    result[normalizedKey] = normalizedValue;
  }
  return result;
}

function normalizePreservedStringMap(input: unknown): Record<string, string> {
  if (!isRecord(input)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string') {
      continue;
    }
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }
    result[normalizedKey] = value;
  }
  return result;
}

function joinArchivePath(...segments: string[]): string {
  return segments
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .join('/');
}

type ArchiveEntryPaths = {
  stateCore: string;
  uiSelection: string;
  settingsGeneral: string;
  settingsModelConfig: string;
  settingsDefaultModels: string;
  settingsMcp: string;
  providerApiKeys: string;
  kv: string;
  sessionsIndex: string;
  session: (assistantId: string, sessionId: string) => string;
};

function createArchiveEntryPaths(rootDirName = ''): ArchiveEntryPaths {
  return {
    stateCore: joinArchivePath(rootDirName, COMPASS_META_DIR_NAME, STRUCTURED_STATE_CORE_FILE_NAME),
    uiSelection: joinArchivePath(rootDirName, COMPASS_META_DIR_NAME, STRUCTURED_UI_SELECTION_FILE_NAME),
    settingsGeneral: joinArchivePath(rootDirName, COMPASS_META_DIR_NAME, STRUCTURED_SETTINGS_GENERAL_FILE_NAME),
    settingsModelConfig: joinArchivePath(
      rootDirName,
      COMPASS_META_DIR_NAME,
      STRUCTURED_SETTINGS_MODEL_CONFIG_FILE_NAME
    ),
    settingsDefaultModels: joinArchivePath(
      rootDirName,
      COMPASS_META_DIR_NAME,
      STRUCTURED_SETTINGS_DEFAULT_MODELS_FILE_NAME
    ),
    settingsMcp: joinArchivePath(rootDirName, COMPASS_META_DIR_NAME, STRUCTURED_SETTINGS_MCP_FILE_NAME),
    providerApiKeys: joinArchivePath(
      rootDirName,
      COMPASS_META_DIR_NAME,
      STRUCTURED_PROVIDER_API_KEYS_FILE_NAME
    ),
    kv: joinArchivePath(rootDirName, COMPASS_META_DIR_NAME, COMPASS_KV_FILE_NAME),
    sessionsIndex: joinArchivePath(rootDirName, COMPASS_SESSIONS_DIR_NAME, COMPASS_INDEX_FILE_NAME),
    session: (assistantId: string, sessionId: string) =>
      joinArchivePath(rootDirName, COMPASS_SESSIONS_DIR_NAME, assistantId, `${sessionId}.jsonl`)
  };
}

const ARCHIVE_ENTRY_PATHS = createArchiveEntryPaths();

function buildSessionFileBytes(session: ChatSessionDetail): Uint8Array {
  const content = session.messages.map((message) => JSON.stringify(message)).join('\n');
  return Buffer.from(content ? `${content}\n` : '', 'utf8');
}

function buildSessionIndex(sessions: ChatBuddyBackupData['storage']['sessions']): CompassIndexFile {
  return {
    sessions: [...sessions]
      .map((session) => ({
        id: session.id,
        assistantId: session.assistantId,
        title: session.title,
        titleSource: session.titleSource,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        preview: buildPreview(session.messages)
      }))
      .sort((left, right) => {
        const byCreatedAt = left.createdAt - right.createdAt;
        if (byCreatedAt !== 0) {
          return byCreatedAt;
        }
        return left.id.localeCompare(right.id);
      })
  };
}

function buildBackupArchiveManifest(backup: ChatBuddyBackupData): BackupArchiveManifest {
  return {
    schema: backup.schema,
    version: backup.version,
    exportedAt: backup.exportedAt,
    packageFormat: BACKUP_ARCHIVE_PACKAGE_FORMAT,
    storage: {
      layout: backup.storage.layout,
      layoutVersion: backup.storage.layoutVersion
    }
  };
}

function buildBackupArchiveEntries(backup: ChatBuddyBackupData): ZipEntry[] {
  const entries: ZipEntry[] = [
    {
      path: BACKUP_ARCHIVE_MANIFEST_PATH,
      data: toJsonBytes(buildBackupArchiveManifest(backup))
    },
    {
      path: ARCHIVE_ENTRY_PATHS.stateCore,
      data: toJsonBytes(backup.storage.structuredState.core)
    },
    {
      path: ARCHIVE_ENTRY_PATHS.uiSelection,
      data: toJsonBytes(backup.storage.structuredState.ui)
    },
    {
      path: ARCHIVE_ENTRY_PATHS.settingsGeneral,
      data: toJsonBytes(backup.storage.structuredState.settingsGeneral)
    },
    {
      path: ARCHIVE_ENTRY_PATHS.settingsModelConfig,
      data: toJsonBytes(backup.storage.structuredState.settingsModelConfig)
    },
    {
      path: ARCHIVE_ENTRY_PATHS.settingsDefaultModels,
      data: toJsonBytes(backup.storage.structuredState.settingsDefaultModels)
    },
    {
      path: ARCHIVE_ENTRY_PATHS.settingsMcp,
      data: toJsonBytes(backup.storage.structuredState.settingsMcp)
    },
    {
      path: ARCHIVE_ENTRY_PATHS.sessionsIndex,
      data: toJsonBytes(buildSessionIndex(backup.storage.sessions))
    }
  ];

  if (Object.keys(backup.storage.providerApiKeys).length > 0) {
    entries.push({
      path: ARCHIVE_ENTRY_PATHS.providerApiKeys,
      data: toJsonBytes(backup.storage.providerApiKeys)
    });
  }

  if (Object.keys(backup.storage.kv).length > 0) {
    entries.push({
      path: ARCHIVE_ENTRY_PATHS.kv,
      data: toJsonBytes(backup.storage.kv)
    });
  }

  for (const session of backup.storage.sessions) {
    entries.push({
      path: ARCHIVE_ENTRY_PATHS.session(session.assistantId, session.id),
      data: buildSessionFileBytes(session)
    });
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function createZipArchive(entries: ZipEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, 'utf8');
    const dataBytes = Buffer.from(entry.data);
    const checksum = crc32(dataBytes);

    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(ZIP_STORE_METHOD, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(dataBytes.length, 18);
    localHeader.writeUInt32LE(dataBytes.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBytes.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBytes.length);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(ZIP_STORE_METHOD, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(dataBytes.length, 20);
    centralHeader.writeUInt32LE(dataBytes.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    nameBytes.copy(centralHeader, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + dataBytes.length;
  }

  const centralOffset = localOffset;
  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(centralOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function findEndOfCentralDirectoryOffset(data: Buffer): number {
  const minimumOffset = Math.max(0, data.length - 0xffff - 22);
  for (let offset = data.length - 22; offset >= minimumOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  throw new Error('ZIP end of central directory not found');
}

export function readZipArchiveEntries(data: Uint8Array): Map<string, Uint8Array> {
  const archive = Buffer.from(data);
  const eocdOffset = findEndOfCentralDirectoryOffset(archive);
  const totalEntries = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);

  const entries = new Map<string, Uint8Array>();
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('ZIP central directory entry is invalid');
    }
    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const expectedChecksum = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);

    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString((flags & ZIP_UTF8_FLAG) ? 'utf8' : 'utf8');

    if (archive.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`ZIP local header is invalid for entry: ${name}`);
    }
    const localFlags = archive.readUInt16LE(localHeaderOffset + 6);
    const localCompressionMethod = archive.readUInt16LE(localHeaderOffset + 8);
    if ((flags & 0x0008) !== 0 || (localFlags & 0x0008) !== 0) {
      throw new Error(`ZIP data descriptor is not supported for entry: ${name}`);
    }
    if (localCompressionMethod !== compressionMethod) {
      throw new Error(`ZIP compression method mismatch for entry: ${name}`);
    }

    const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = archive.subarray(dataOffset, dataOffset + compressedSize);

    let content: Uint8Array;
    if (compressionMethod === ZIP_STORE_METHOD) {
      content = Buffer.from(compressedData);
    } else if (compressionMethod === ZIP_DEFLATE_METHOD) {
      content = inflateRawSync(compressedData);
    } else {
      throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
    }

    if (content.length !== uncompressedSize) {
      throw new Error(`ZIP entry size mismatch for entry: ${name}`);
    }
    if (crc32(content) !== expectedChecksum) {
      throw new Error(`ZIP checksum mismatch for entry: ${name}`);
    }

    if (entries.has(name)) {
      throw new Error(`ZIP archive contains duplicate entry: ${name}`);
    }
    entries.set(name, content);
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

export function isZipArchive(data: Uint8Array): boolean {
  return data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07) &&
    (data[3] === 0x04 || data[3] === 0x06 || data[3] === 0x08);
}

export function createBackupArchive(backup: ChatBuddyBackupData): Uint8Array {
  return createZipArchive(buildBackupArchiveEntries(backup));
}

function resolveArchiveEntry(entries: Map<string, Uint8Array>, entryPath: string): { path: string; data: Uint8Array } | undefined {
  const currentEntry = entries.get(entryPath);
  if (currentEntry) {
    return {
      path: entryPath,
      data: currentEntry
    };
  }

  const expectedDepth = entryPath.split('/').length + 1;
  const rootedMatches: Array<{ path: string; data: Uint8Array }> = [];
  const expectedSuffix = `/${entryPath}`;
  for (const [candidatePath, data] of entries.entries()) {
    if (!candidatePath.endsWith(expectedSuffix)) {
      continue;
    }
    if (candidatePath.split('/').length !== expectedDepth) {
      continue;
    }
    rootedMatches.push({
      path: candidatePath,
      data
    });
  }

  if (rootedMatches.length > 1) {
    throw new Error(`Backup archive entry is ambiguous: ${entryPath}`);
  }
  return rootedMatches[0];
}

function parseArchiveJsonEntry<T>(entries: Map<string, Uint8Array>, entryPath: string): T {
  const entry = resolveArchiveEntry(entries, entryPath);
  if (!entry) {
    throw new Error(`Backup archive entry is missing: ${entryPath}`);
  }
  try {
    return JSON.parse(Buffer.from(entry.data).toString('utf8')) as T;
  } catch {
    throw new Error(`Backup archive entry is not valid JSON: ${entry.path}`);
  }
}

function parseOptionalArchiveJsonEntry<T>(entries: Map<string, Uint8Array>, entryPath: string): T | undefined {
  const entry = resolveArchiveEntry(entries, entryPath);
  if (!entry) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(entry.data).toString('utf8')) as T;
  } catch {
    throw new Error(`Backup archive entry is not valid JSON: ${entry.path}`);
  }
}

function parseBackupArchiveManifest(entries: Map<string, Uint8Array>): BackupArchiveManifest {
  const manifest = parseArchiveJsonEntry<BackupArchiveManifest>(entries, BACKUP_ARCHIVE_MANIFEST_PATH);
  if (!isRecord(manifest)) {
    throw new Error('Backup archive manifest is invalid');
  }
  if (manifest.schema !== 'chatbuddy.backup.compass') {
    throw new Error(`Backup archive schema is not supported: ${String(manifest.schema)}`);
  }
  if (!Number.isFinite(manifest.version) || manifest.version < 2) {
    throw new Error(`Backup archive version is not supported: ${String(manifest.version)}`);
  }
  if (manifest.version > SUPPORTED_BACKUP_VERSION) {
    throw new Error(`Backup archive version is newer than supported: ${String(manifest.version)}`);
  }
  if (typeof manifest.exportedAt !== 'string' || !manifest.exportedAt.trim()) {
    throw new Error('Backup archive exportedAt is invalid');
  }
  if (manifest.packageFormat !== BACKUP_ARCHIVE_PACKAGE_FORMAT) {
    throw new Error(`Backup archive package format is not supported: ${String(manifest.packageFormat)}`);
  }
  if (!isRecord(manifest.storage) || manifest.storage.layout !== 'compass') {
    throw new Error('Backup archive storage layout is invalid');
  }
  if (!Number.isFinite(manifest.storage.layoutVersion)) {
    throw new Error('Backup archive storage layout version is invalid');
  }
  if (manifest.storage.layoutVersion > COMPASS_LAYOUT_VERSION) {
    throw new Error(`Backup archive layout version is newer than supported: ${String(manifest.storage.layoutVersion)}`);
  }
  return manifest;
}

function parseSessionMessagesFromArchive(
  entries: Map<string, Uint8Array>,
  assistantId: string,
  sessionId: string
): ChatMessage[] {
  const sessionFilePath = ARCHIVE_ENTRY_PATHS.session(assistantId, sessionId);
  const sessionFile = resolveArchiveEntry(entries, sessionFilePath);
  if (!sessionFile) {
    throw new Error(`Backup session file is missing: ${sessionFilePath}`);
  }

  const rawContent = Buffer.from(sessionFile.data).toString('utf8');
  if (!rawContent.trim()) {
    return [];
  }

  const messages: ChatMessage[] = [];
  const lines = rawContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    try {
      const parsed = JSON.parse(lines[lineIndex]) as unknown;
      if (!isRecord(parsed)) {
        throw new Error('Session message is not an object');
      }
      messages.push(parsed as unknown as ChatMessage);
    } catch {
      throw new Error(`Backup session file contains invalid JSONL: ${sessionFile.path} (line ${lineIndex + 1})`);
    }
  }
  return messages;
}

function parseSessionsFromArchive(entries: Map<string, Uint8Array>): ChatBuddyBackupData['storage']['sessions'] {
  const indexPayload = parseArchiveJsonEntry<CompassIndexFile>(entries, ARCHIVE_ENTRY_PATHS.sessionsIndex);
  if (!isRecord(indexPayload) || !Array.isArray(indexPayload.sessions)) {
    throw new Error('Backup session index is invalid');
  }

  const now = Date.now();
  const seenSessionIds = new Set<string>();
  const seenSessionFilePaths = new Set<string>();
  return indexPayload.sessions.map((rawSummary, index) => {
    if (!isRecord(rawSummary)) {
      throw new Error(`Backup session index entry is invalid at position ${index}`);
    }
    const summary = normalizeSummary(rawSummary as CompassIndexFile['sessions'][number], now);
    if (!summary.id || !summary.assistantId) {
      throw new Error(`Backup session index entry is incomplete at position ${index}`);
    }

    const sessionFilePath = ARCHIVE_ENTRY_PATHS.session(summary.assistantId, summary.id);
    if (seenSessionFilePaths.has(sessionFilePath)) {
      throw new Error(`Backup session index contains duplicate session file reference: ${sessionFilePath}`);
    }
    if (seenSessionIds.has(summary.id)) {
      throw new Error(`Backup session index contains duplicate session id: ${summary.id}`);
    }
    seenSessionFilePaths.add(sessionFilePath);
    seenSessionIds.add(summary.id);

    const messages = parseSessionMessagesFromArchive(entries, summary.assistantId, summary.id);
    if (summary.messageCount !== messages.length) {
      throw new Error(`Backup session index does not match session file: ${summary.id}`);
    }

    return {
      id: summary.id,
      assistantId: summary.assistantId,
      title: summary.title,
      titleSource: summary.titleSource,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      messages
    };
  });
}

export function extractBackupPayloadFromArchive(data: Uint8Array): unknown {
  const entries = readZipArchiveEntries(data);
  const manifest = parseBackupArchiveManifest(entries);

  return {
    schema: SUPPORTED_BACKUP_SCHEMA,
    version: manifest.version,
    exportedAt: manifest.exportedAt,
    storage: {
      layout: manifest.storage.layout,
      layoutVersion: manifest.storage.layoutVersion,
      structuredState: {
        core: parseArchiveJsonEntry(entries, ARCHIVE_ENTRY_PATHS.stateCore),
        ui: parseArchiveJsonEntry(entries, ARCHIVE_ENTRY_PATHS.uiSelection),
        settingsGeneral: parseArchiveJsonEntry(entries, ARCHIVE_ENTRY_PATHS.settingsGeneral),
        settingsModelConfig: parseArchiveJsonEntry(entries, ARCHIVE_ENTRY_PATHS.settingsModelConfig),
        settingsDefaultModels: parseArchiveJsonEntry(entries, ARCHIVE_ENTRY_PATHS.settingsDefaultModels),
        settingsMcp: parseArchiveJsonEntry(entries, ARCHIVE_ENTRY_PATHS.settingsMcp)
      },
      providerApiKeys: normalizeTrimmedStringMap(parseOptionalArchiveJsonEntry(entries, ARCHIVE_ENTRY_PATHS.providerApiKeys)),
      sessions: parseSessionsFromArchive(entries),
      kv: normalizePreservedStringMap(parseOptionalArchiveJsonEntry(entries, ARCHIVE_ENTRY_PATHS.kv))
    }
  } satisfies ChatBuddyBackupData;
}
