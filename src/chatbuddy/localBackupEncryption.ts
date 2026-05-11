/**
 * 本地备份加密模块。
 *
 * 使用 AES-256-GCM 算法对备份 ZIP 字节流进行加密。
 * 文件结构: [magic 8B "CBENCv01"][salt 16B][iv 12B][authTag 16B][ciphertext...]
 * 密码通过 PBKDF2-SHA256 派生为 256-bit 密钥（100000 次迭代）。
 */
import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'crypto';
import { promisify } from 'util';

const pbkdf2Async = promisify(pbkdf2);

const MAGIC = Buffer.from('CBENCv01', 'utf8'); // 8 bytes
const MAGIC_LENGTH = MAGIC.length;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32; // AES-256
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';
const ENCRYPTED_FILE_SUFFIX = '.enc.zip';
const PLAIN_FILE_SUFFIX = '.zip';

/**
 * 检查字节流是否为加密备份格式。
 */
export function isEncryptedBackup(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC_LENGTH) {
    return false;
  }
  for (let i = 0; i < MAGIC_LENGTH; i++) {
    if (bytes[i] !== MAGIC[i]) {
      return false;
    }
  }
  return true;
}

/**
 * 加密备份字节流。
 */
export async function encryptBackup(plaintext: Uint8Array, password: string): Promise<Uint8Array> {
  if (!password) {
    throw new Error('Encryption password is required');
  }
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = await pbkdf2Async(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, encrypted]);
}

/**
 * 解密备份字节流。失败时抛出错误（密码错误、数据损坏等）。
 */
export async function decryptBackup(ciphertext: Uint8Array, password: string): Promise<Uint8Array> {
  if (!isEncryptedBackup(ciphertext)) {
    throw new Error('Not an encrypted backup');
  }
  if (!password) {
    throw new Error('Decryption password is required');
  }
  const buf = Buffer.from(ciphertext);
  let offset = MAGIC_LENGTH;
  const salt = buf.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const iv = buf.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;
  const tag = buf.subarray(offset, offset + TAG_LENGTH);
  offset += TAG_LENGTH;
  const encrypted = buf.subarray(offset);
  const key = await pbkdf2Async(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export { ENCRYPTED_FILE_SUFFIX, PLAIN_FILE_SUFFIX };
