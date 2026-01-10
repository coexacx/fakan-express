const crypto = require('crypto');
const { config } = require('./config');

function keyFromSecret(secret) {
  // Derive 32-byte key from arbitrary secret string.
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

const KEY = keyFromSecret(config.cardSecret);

function encryptText(plainText) {
  const iv = crypto.randomBytes(12); // recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as base64: iv.tag.ciphertext
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

function decryptText(payload) {
  const parts = String(payload).split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted payload format');
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function timingSafeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function hmacSha256Hex(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

module.exports = {
  encryptText,
  decryptText,
  sha256Hex,
  timingSafeEqual,
  hmacSha256Hex,
};
