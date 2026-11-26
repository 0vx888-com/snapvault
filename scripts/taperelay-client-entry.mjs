// Browser entry: only official modules needed for encrypted upload/resume/playback.
// Do not import the package root or player.mjs — those pull the TapeKit kernel (Node-only bits).
export { planEncryptedFile, planEncryptedResume, resumableOf, generateKeyPair, readEncryptedFileWithKey, openEncryptedFileWithKey } from '../vendor/taperelay-client/src/encrypted.mjs';
export { uploadToServers } from '../vendor/taperelay-client/src/upload.mjs';
export { createClient } from '../vendor/taperelay-client/src/client.mjs';
export { remoteAuth } from '../vendor/taperelay-client/src/remote.mjs';
export { faststart } from '../vendor/taperelay-client/src/faststart.mjs';
export { ENCRYPTED_CHUNK } from '../vendor/taperelay-client/src/manifest.mjs';
export { streamMedia } from '../vendor/taperelay-client/src/mediasource.mjs';
export { saveFile, cleanupTempDownloads } from '../vendor/taperelay-client/src/savefile.mjs';
export { sha256 } from '@noble/hashes/sha2.js';
