/* Official TapeRelay client APIs, MIT. See taperelay-client-LICENSE.md. Vendored from @taperelay/client 0.1.0-test.132. */

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+ciphers@2.4.0/node_modules/@noble/ciphers/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function abool(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
var aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(label === "object" ? "expected valid options object" : `"${label}" expected object, got type=${typeof value}`);
};
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word2) {
  return word2 << 24 & 4278190080 | word2 << 8 & 16711680 | word2 >>> 8 & 65280 | word2 >>> 24 & 255;
}
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
function overlapBytes(a, b) {
  if (!a.byteLength || !b.byteLength)
    return false;
  return a.buffer === b.buffer && // best we can do, may fail with an obscure Proxy
  a.byteOffset < b.byteOffset + b.byteLength && // a starts before b end
  b.byteOffset < a.byteOffset + a.byteLength;
}
function complexOverlapBytes(input, output) {
  if (overlapBytes(input, output) && input.byteOffset < output.byteOffset)
    throw new Error("complex overlap of input and output is not supported");
}
function checkOpts(defaults, opts) {
  aobject(defaults, "defaults");
  aobject(opts, "opts");
  const merged = Object.assign(defaults, opts);
  return merged;
}
function equalBytes(a, b) {
  a = abytes(a);
  b = abytes(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function wrapMacConstructor(keyLen, macCons, fromMsg) {
  const mac = macCons;
  const getArgs = fromMsg || (() => []);
  const macC = (msg, key) => mac(key, ...getArgs(msg)).update(msg).digest();
  const tmp = mac(new Uint8Array(keyLen), ...getArgs(new Uint8Array(0)));
  macC.outputLen = tmp.outputLen;
  macC.blockLen = tmp.blockLen;
  macC.create = (key, ...args) => mac(key, ...args);
  return macC;
}
var wrapCipher = /* @__NO_SIDE_EFFECTS__ */ (params, constructor) => {
  function wrappedCipher(key, ...args) {
    abytes(key, void 0, "key");
    if (params.nonceLength !== void 0) {
      const nonce = args[0];
      abytes(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
    }
    const tagl = params.tagLength;
    const aadStart = params.nonceLength !== void 0 ? 1 : 0;
    if (!params.withAAD) {
      for (let i = aadStart; i < args.length; i++)
        if (isBytes(args[i]))
          throw new Error("AAD not supported");
    }
    if (params.withAAD && args[aadStart] !== void 0)
      abytes(args[aadStart], void 0, "AAD");
    const cipher = constructor(key, ...args);
    const checkOutput = (fnLength, output) => {
      if (output !== void 0) {
        if (fnLength !== 2)
          throw new Error("cipher output not supported");
        abytes(output, void 0, "output");
      }
    };
    let called = false;
    const wrCipher = {
      encrypt(data, output) {
        if (called)
          throw new Error("cannot encrypt() twice with same key + nonce");
        called = true;
        abytes(data, void 0, "data");
        checkOutput(cipher.encrypt.length, output);
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes(data, void 0, "data");
        if (tagl && data.length < tagl)
          throw new Error('"ciphertext" expected length >= tagLength=' + tagl);
        checkOutput(cipher.decrypt.length, output);
        return cipher.decrypt(data, output);
      }
    };
    return wrCipher;
  }
  Object.assign(wrappedCipher, params);
  return wrappedCipher;
};
function getOutput(expectedLength, out, onlyAligned = true) {
  if (out === void 0)
    return new Uint8Array(expectedLength);
  abytes(out, expectedLength, "output");
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
  return out;
}
function u64Lengths(dataLength, aadLength, isLE3) {
  anumber(dataLength);
  anumber(aadLength);
  abool(isLE3);
  const num = new Uint8Array(16);
  const view = createView(num);
  view.setBigUint64(0, BigInt(aadLength), isLE3);
  view.setBigUint64(8, BigInt(dataLength), isLE3);
  return num;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes(bytes));
}

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+ciphers@2.4.0/node_modules/@noble/ciphers/_arx.js
var encodeStr = (str) => Uint8Array.from(str.split(""), (c) => c.charCodeAt(0));
var sigma16_32 = /* @__PURE__ */ (() => swap32IfBE(u32(encodeStr("expand 16-byte k"))))();
var sigma32_32 = /* @__PURE__ */ (() => swap32IfBE(u32(encodeStr("expand 32-byte k"))))();
function rotl(a, b) {
  return a << b | a >>> 32 - b;
}
var BLOCK_LEN = 64;
var BLOCK_LEN32 = 16;
var MAX_COUNTER = /* @__PURE__ */ (() => 2 ** 32 - 1)();
var U32_EMPTY = /* @__PURE__ */ Uint32Array.of();
function runCipher(core, sigma, key, nonce, data, output, counter, rounds) {
  const len = data.length;
  const block = new Uint8Array(BLOCK_LEN);
  const b32 = u32(block);
  const isAligned = isLE && isAligned32(data) && isAligned32(output);
  const d32 = isAligned ? u32(data) : U32_EMPTY;
  const o32 = isAligned ? u32(output) : U32_EMPTY;
  if (!isLE) {
    for (let pos = 0; pos < len; counter++) {
      core(sigma, key, nonce, b32, counter, rounds);
      swap32IfBE(b32);
      if (counter >= MAX_COUNTER)
        throw new Error("arx: counter overflow");
      const take = Math.min(BLOCK_LEN, len - pos);
      for (let j = 0, posj; j < take; j++) {
        posj = pos + j;
        output[posj] = data[posj] ^ block[j];
      }
      pos += take;
    }
    return;
  }
  for (let pos = 0; pos < len; counter++) {
    core(sigma, key, nonce, b32, counter, rounds);
    if (counter >= MAX_COUNTER)
      throw new Error("arx: counter overflow");
    const take = Math.min(BLOCK_LEN, len - pos);
    if (isAligned && take === BLOCK_LEN) {
      const pos32 = pos / 4;
      if (pos % 4 !== 0)
        throw new Error("arx: invalid block position");
      for (let j = 0, posj; j < BLOCK_LEN32; j++) {
        posj = pos32 + j;
        o32[posj] = d32[posj] ^ b32[j];
      }
      pos += BLOCK_LEN;
      continue;
    }
    for (let j = 0, posj; j < take; j++) {
      posj = pos + j;
      output[posj] = data[posj] ^ block[j];
    }
    pos += take;
  }
}
function createCipher(core, opts) {
  const { allowShortKeys, extendNonceFn, counterLength, counterRight, rounds } = checkOpts({ allowShortKeys: false, counterLength: 8, counterRight: false, rounds: 20 }, opts);
  if (typeof core !== "function")
    throw new Error("core must be a function");
  anumber(counterLength);
  anumber(rounds);
  abool(counterRight);
  abool(allowShortKeys);
  return (key, nonce, data, output, counter = 0) => {
    abytes(key, void 0, "key");
    abytes(nonce, void 0, "nonce");
    abytes(data, void 0, "data");
    const len = data.length;
    const hasOutput = output !== void 0;
    output = getOutput(len, output, false);
    if (hasOutput)
      complexOverlapBytes(data, output);
    anumber(counter);
    if (counter < 0 || counter >= MAX_COUNTER)
      throw new Error("arx: counter overflow");
    const toClean = [];
    let l = key.length;
    let k;
    let sigma;
    if (l === 32) {
      toClean.push(k = copyBytes(key));
      sigma = sigma32_32;
    } else if (l === 16 && allowShortKeys) {
      k = new Uint8Array(32);
      k.set(key);
      k.set(key, 16);
      sigma = sigma16_32;
      toClean.push(k);
    } else {
      abytes(key, 32, "arx key");
      throw new Error("invalid key size");
    }
    if (!isLE || !isAligned32(nonce))
      toClean.push(nonce = copyBytes(nonce));
    let k32 = u32(k);
    if (extendNonceFn) {
      if (nonce.length !== 24)
        throw new Error("arx: extended nonce must be 24 bytes");
      const n16 = nonce.subarray(0, 16);
      if (isLE)
        extendNonceFn(sigma, k32, u32(n16), k32);
      else {
        const sigmaRaw = swap32IfBE(Uint32Array.from(sigma));
        extendNonceFn(sigmaRaw, k32, u32(n16), k32);
        clean(sigmaRaw);
        swap32IfBE(k32);
      }
      nonce = nonce.subarray(16);
    } else if (!isLE)
      swap32IfBE(k32);
    const nonceNcLen = 16 - counterLength;
    if (nonceNcLen !== nonce.length)
      throw new Error(`arx: nonce must be ${nonceNcLen} or 16 bytes`);
    if (nonceNcLen !== 12) {
      const nc = new Uint8Array(12);
      nc.set(nonce, counterRight ? 0 : 12 - nonce.length);
      nonce = nc;
      toClean.push(nonce);
    }
    const n32 = swap32IfBE(u32(nonce));
    try {
      runCipher(core, sigma, k32, n32, data, output, counter, rounds);
      return output;
    } finally {
      clean(...toClean);
    }
  };
}

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+ciphers@2.4.0/node_modules/@noble/ciphers/_poly1305.js
function u8to16(a, i) {
  return a[i++] & 255 | (a[i++] & 255) << 8;
}
var Poly1305 = class {
  blockLen = 16;
  outputLen = 16;
  buffer = new Uint8Array(16);
  r = new Uint16Array(10);
  // Allocating 1 array with .subarray() here is slower than 3
  h = new Uint16Array(10);
  pad = new Uint16Array(8);
  pos = 0;
  finished = false;
  destroyed = false;
  // Can be speed-up using BigUint64Array, at the cost of complexity
  constructor(key) {
    key = copyBytes(abytes(key, 32, "key"));
    const t0 = u8to16(key, 0);
    const t1 = u8to16(key, 2);
    const t2 = u8to16(key, 4);
    const t3 = u8to16(key, 6);
    const t4 = u8to16(key, 8);
    const t5 = u8to16(key, 10);
    const t6 = u8to16(key, 12);
    const t7 = u8to16(key, 14);
    this.r[0] = t0 & 8191;
    this.r[1] = (t0 >>> 13 | t1 << 3) & 8191;
    this.r[2] = (t1 >>> 10 | t2 << 6) & 7939;
    this.r[3] = (t2 >>> 7 | t3 << 9) & 8191;
    this.r[4] = (t3 >>> 4 | t4 << 12) & 255;
    this.r[5] = t4 >>> 1 & 8190;
    this.r[6] = (t4 >>> 14 | t5 << 2) & 8191;
    this.r[7] = (t5 >>> 11 | t6 << 5) & 8065;
    this.r[8] = (t6 >>> 8 | t7 << 8) & 8191;
    this.r[9] = t7 >>> 5 & 127;
    for (let i = 0; i < 8; i++)
      this.pad[i] = u8to16(key, 16 + 2 * i);
  }
  process(data, offset, isLast = false) {
    const hibit = isLast ? 0 : 1 << 11;
    const { h, r } = this;
    const r0 = r[0];
    const r1 = r[1];
    const r2 = r[2];
    const r3 = r[3];
    const r4 = r[4];
    const r5 = r[5];
    const r6 = r[6];
    const r7 = r[7];
    const r8 = r[8];
    const r9 = r[9];
    const t0 = u8to16(data, offset + 0);
    const t1 = u8to16(data, offset + 2);
    const t2 = u8to16(data, offset + 4);
    const t3 = u8to16(data, offset + 6);
    const t4 = u8to16(data, offset + 8);
    const t5 = u8to16(data, offset + 10);
    const t6 = u8to16(data, offset + 12);
    const t7 = u8to16(data, offset + 14);
    let h0 = h[0] + (t0 & 8191);
    let h1 = h[1] + ((t0 >>> 13 | t1 << 3) & 8191);
    let h2 = h[2] + ((t1 >>> 10 | t2 << 6) & 8191);
    let h3 = h[3] + ((t2 >>> 7 | t3 << 9) & 8191);
    let h4 = h[4] + ((t3 >>> 4 | t4 << 12) & 8191);
    let h5 = h[5] + (t4 >>> 1 & 8191);
    let h6 = h[6] + ((t4 >>> 14 | t5 << 2) & 8191);
    let h7 = h[7] + ((t5 >>> 11 | t6 << 5) & 8191);
    let h8 = h[8] + ((t6 >>> 8 | t7 << 8) & 8191);
    let h9 = h[9] + (t7 >>> 5 | hibit);
    let c = 0;
    let d0 = c + h0 * r0 + h1 * (5 * r9) + h2 * (5 * r8) + h3 * (5 * r7) + h4 * (5 * r6);
    c = d0 >>> 13;
    d0 &= 8191;
    d0 += h5 * (5 * r5) + h6 * (5 * r4) + h7 * (5 * r3) + h8 * (5 * r2) + h9 * (5 * r1);
    c += d0 >>> 13;
    d0 &= 8191;
    let d1 = c + h0 * r1 + h1 * r0 + h2 * (5 * r9) + h3 * (5 * r8) + h4 * (5 * r7);
    c = d1 >>> 13;
    d1 &= 8191;
    d1 += h5 * (5 * r6) + h6 * (5 * r5) + h7 * (5 * r4) + h8 * (5 * r3) + h9 * (5 * r2);
    c += d1 >>> 13;
    d1 &= 8191;
    let d2 = c + h0 * r2 + h1 * r1 + h2 * r0 + h3 * (5 * r9) + h4 * (5 * r8);
    c = d2 >>> 13;
    d2 &= 8191;
    d2 += h5 * (5 * r7) + h6 * (5 * r6) + h7 * (5 * r5) + h8 * (5 * r4) + h9 * (5 * r3);
    c += d2 >>> 13;
    d2 &= 8191;
    let d3 = c + h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * (5 * r9);
    c = d3 >>> 13;
    d3 &= 8191;
    d3 += h5 * (5 * r8) + h6 * (5 * r7) + h7 * (5 * r6) + h8 * (5 * r5) + h9 * (5 * r4);
    c += d3 >>> 13;
    d3 &= 8191;
    let d4 = c + h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;
    c = d4 >>> 13;
    d4 &= 8191;
    d4 += h5 * (5 * r9) + h6 * (5 * r8) + h7 * (5 * r7) + h8 * (5 * r6) + h9 * (5 * r5);
    c += d4 >>> 13;
    d4 &= 8191;
    let d5 = c + h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1;
    c = d5 >>> 13;
    d5 &= 8191;
    d5 += h5 * r0 + h6 * (5 * r9) + h7 * (5 * r8) + h8 * (5 * r7) + h9 * (5 * r6);
    c += d5 >>> 13;
    d5 &= 8191;
    let d6 = c + h0 * r6 + h1 * r5 + h2 * r4 + h3 * r3 + h4 * r2;
    c = d6 >>> 13;
    d6 &= 8191;
    d6 += h5 * r1 + h6 * r0 + h7 * (5 * r9) + h8 * (5 * r8) + h9 * (5 * r7);
    c += d6 >>> 13;
    d6 &= 8191;
    let d7 = c + h0 * r7 + h1 * r6 + h2 * r5 + h3 * r4 + h4 * r3;
    c = d7 >>> 13;
    d7 &= 8191;
    d7 += h5 * r2 + h6 * r1 + h7 * r0 + h8 * (5 * r9) + h9 * (5 * r8);
    c += d7 >>> 13;
    d7 &= 8191;
    let d8 = c + h0 * r8 + h1 * r7 + h2 * r6 + h3 * r5 + h4 * r4;
    c = d8 >>> 13;
    d8 &= 8191;
    d8 += h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * (5 * r9);
    c += d8 >>> 13;
    d8 &= 8191;
    let d9 = c + h0 * r9 + h1 * r8 + h2 * r7 + h3 * r6 + h4 * r5;
    c = d9 >>> 13;
    d9 &= 8191;
    d9 += h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
    c += d9 >>> 13;
    d9 &= 8191;
    c = (c << 2) + c | 0;
    c = c + d0 | 0;
    d0 = c & 8191;
    c = c >>> 13;
    d1 += c;
    h[0] = d0;
    h[1] = d1;
    h[2] = d2;
    h[3] = d3;
    h[4] = d4;
    h[5] = d5;
    h[6] = d6;
    h[7] = d7;
    h[8] = d8;
    h[9] = d9;
  }
  finalize() {
    const { h, pad } = this;
    const g = new Uint16Array(10);
    let c = h[1] >>> 13;
    h[1] &= 8191;
    for (let i = 2; i < 10; i++) {
      h[i] += c;
      c = h[i] >>> 13;
      h[i] &= 8191;
    }
    h[0] += c * 5;
    c = h[0] >>> 13;
    h[0] &= 8191;
    h[1] += c;
    c = h[1] >>> 13;
    h[1] &= 8191;
    h[2] += c;
    g[0] = h[0] + 5;
    c = g[0] >>> 13;
    g[0] &= 8191;
    for (let i = 1; i < 10; i++) {
      g[i] = h[i] + c;
      c = g[i] >>> 13;
      g[i] &= 8191;
    }
    g[9] -= 1 << 13;
    let mask = (c ^ 1) - 1;
    for (let i = 0; i < 10; i++)
      g[i] &= mask;
    mask = ~mask;
    for (let i = 0; i < 10; i++)
      h[i] = h[i] & mask | g[i];
    h[0] = (h[0] | h[1] << 13) & 65535;
    h[1] = (h[1] >>> 3 | h[2] << 10) & 65535;
    h[2] = (h[2] >>> 6 | h[3] << 7) & 65535;
    h[3] = (h[3] >>> 9 | h[4] << 4) & 65535;
    h[4] = (h[4] >>> 12 | h[5] << 1 | h[6] << 14) & 65535;
    h[5] = (h[6] >>> 2 | h[7] << 11) & 65535;
    h[6] = (h[7] >>> 5 | h[8] << 8) & 65535;
    h[7] = (h[8] >>> 8 | h[9] << 5) & 65535;
    let f = h[0] + pad[0];
    h[0] = f & 65535;
    for (let i = 1; i < 8; i++) {
      f = (h[i] + pad[i] | 0) + (f >>> 16) | 0;
      h[i] = f & 65535;
    }
    clean(g);
  }
  update(data) {
    aexists(this);
    abytes(data);
    data = copyBytes(data);
    const { buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(data, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(buffer, 0, false);
        this.pos = 0;
      }
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    clean(this.h, this.r, this.buffer, this.pad);
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, h } = this;
    let { pos } = this;
    if (pos) {
      buffer[pos++] = 1;
      for (; pos < 16; pos++)
        buffer[pos] = 0;
      this.process(buffer, 0, true);
    }
    this.finalize();
    let opos = 0;
    for (let i = 0; i < 8; i++) {
      out[opos++] = h[i] >>> 0;
      out[opos++] = h[i] >>> 8;
    }
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
};
var poly1305 = /* @__PURE__ */ wrapMacConstructor(32, (key) => new Poly1305(key));

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+ciphers@2.4.0/node_modules/@noble/ciphers/chacha.js
function chachaCore(s, k, n, out, cnt, rounds = 20) {
  let y00 = s[0], y01 = s[1], y02 = s[2], y03 = s[3], y04 = k[0], y05 = k[1], y06 = k[2], y07 = k[3], y08 = k[4], y09 = k[5], y10 = k[6], y11 = k[7], y12 = cnt, y13 = n[0], y14 = n[1], y15 = n[2];
  let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
  for (let r = 0; r < rounds; r += 2) {
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 16);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 12);
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 8);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 7);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 16);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 12);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 8);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 7);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 16);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 12);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 8);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 7);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 16);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 12);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 8);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 7);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 16);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 12);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 8);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 7);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 16);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 12);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 8);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 7);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 16);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 12);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 8);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 7);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 16);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 12);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 8);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 7);
  }
  let oi = 0;
  out[oi++] = y00 + x00 | 0;
  out[oi++] = y01 + x01 | 0;
  out[oi++] = y02 + x02 | 0;
  out[oi++] = y03 + x03 | 0;
  out[oi++] = y04 + x04 | 0;
  out[oi++] = y05 + x05 | 0;
  out[oi++] = y06 + x06 | 0;
  out[oi++] = y07 + x07 | 0;
  out[oi++] = y08 + x08 | 0;
  out[oi++] = y09 + x09 | 0;
  out[oi++] = y10 + x10 | 0;
  out[oi++] = y11 + x11 | 0;
  out[oi++] = y12 + x12 | 0;
  out[oi++] = y13 + x13 | 0;
  out[oi++] = y14 + x14 | 0;
  out[oi++] = y15 + x15 | 0;
}
function hchacha(s, k, i, out) {
  const s2 = isLE ? s : swap32IfBE(s.slice(0, 4));
  const k2 = isLE ? k : swap32IfBE(k.slice(0, 8));
  const i2 = isLE ? i : swap32IfBE(i.slice(0, 4));
  const t = new Uint32Array(16);
  chachaCore(s2, k2, i2.subarray(1), t, i2[0]);
  let oi = 0;
  out[oi++] = t[0] - s2[0] | 0;
  out[oi++] = t[1] - s2[1] | 0;
  out[oi++] = t[2] - s2[2] | 0;
  out[oi++] = t[3] - s2[3] | 0;
  out[oi++] = t[12] - i2[0] | 0;
  out[oi++] = t[13] - i2[1] | 0;
  out[oi++] = t[14] - i2[2] | 0;
  out[oi++] = t[15] - i2[3] | 0;
  swap32IfBE(out);
  if (!isLE)
    clean(s2, k2, i2);
  clean(t);
}
var xchacha20 = /* @__PURE__ */ createCipher(chachaCore, {
  counterRight: false,
  counterLength: 8,
  extendNonceFn: hchacha,
  allowShortKeys: false
});
var ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
var updatePadded = (h, msg) => {
  h.update(msg);
  const leftover = msg.length % 16;
  if (leftover)
    h.update(ZEROS16.subarray(leftover));
};
var ZEROS32 = /* @__PURE__ */ new Uint8Array(32);
function computeTag(fn, key, nonce, ciphertext, AAD) {
  if (AAD !== void 0)
    abytes(AAD, void 0, "AAD");
  const authKey = fn(key, nonce, ZEROS32);
  const lengths = u64Lengths(ciphertext.length, AAD ? AAD.length : 0, true);
  const h = poly1305.create(authKey);
  if (AAD)
    updatePadded(h, AAD);
  updatePadded(h, ciphertext);
  h.update(lengths);
  const res = h.digest();
  clean(authKey, lengths);
  return res;
}
var _poly1305_aead = (xorStream) => (key, nonce, AAD) => {
  const tagLength = 16;
  return {
    encrypt(plaintext, output) {
      const plength = plaintext.length;
      output = getOutput(plength + tagLength, output, false);
      output.set(plaintext);
      const oPlain = output.subarray(0, -tagLength);
      xorStream(key, nonce, oPlain, oPlain, 1);
      const tag = computeTag(xorStream, key, nonce, oPlain, AAD);
      output.set(tag, plength);
      clean(tag);
      return output;
    },
    decrypt(ciphertext, output) {
      output = getOutput(ciphertext.length - tagLength, output, false);
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = computeTag(xorStream, key, nonce, data, AAD);
      if (!equalBytes(passedTag, tag)) {
        clean(tag);
        throw new Error("invalid tag");
      }
      output.set(ciphertext.subarray(0, -tagLength));
      xorStream(key, nonce, output, output, 1);
      clean(tag);
      return output;
    }
  };
};
var xchacha20poly1305 = /* @__PURE__ */ wrapCipher(
  { blockSize: 64, nonceLength: 24, tagLength: 16, withAAD: true },
  /* @__PURE__ */ _poly1305_aead(xchacha20)
);

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/_u64.js
var U32_MASK64 = /* @__PURE__ */ (() => BigInt(2 ** 32 - 1))();
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var fromNumH = (n) => n / 2 ** 32 | 0;
var fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE3) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE3 ? l : h, isLE3);
  view.setUint32(byteOffset + 4, isLE3 ? h : l, isLE3);
}
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
var rotr32H = (_h, l) => l;
var rotr32L = (h, _l) => h;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/utils.js
function isBytes2(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle2 = (title) => title ? `"${title}" ` : "";
function anumber2(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle2(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle2(title) + "expected integer >= 0, got " + n);
  return n;
}
function abool2(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle2(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abytes2(value, length, title = "") {
  if (isBytes2(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber2(length, "length");
  const bytes = isBytes2(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle2(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function copyBytes2(bytes) {
  return Uint8Array.from(abytes2(bytes));
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("expected hash wrapped by utils.createHasher");
  anumber2(h.outputLen);
  anumber2(h.blockLen);
  if (h.outputLen < 1 || h.blockLen < 1)
    throw new Error("hash blockLen / outputLen must be >= 1");
}
var aobject2 = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
var aopts = (value, label) => {
  aobject2(value, label);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists2(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput2(out, instance) {
  abytes2(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function u322(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean2(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView2(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word2, shift) {
  return word2 << 32 - shift | word2 >>> shift;
}
var isLE2 = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap2(word2) {
  return word2 << 24 & 4278190080 | word2 << 8 & 16711680 | word2 >>> 8 & 65280 | word2 >>> 24 & 255;
}
var swap8IfBE = isLE2 ? (n) => n : (n) => byteSwap2(n) >>> 0;
function byteSwap322(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap2(arr[i]);
  }
  return arr;
}
var swap32IfBE2 = isLE2 ? (u) => u : byteSwap322;
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes2(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex3 = "";
  for (let i = 0; i < bytes.length; i++) {
    hex3 += hexes[bytes[i]];
  }
  return hex3;
}
function asciiToBase16(ch) {
  return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - (65 - 10) : ch >= 97 && ch <= 102 ? ch - (97 - 10) : void 0;
}
function hexToBytes(hex3) {
  if (typeof hex3 !== "string")
    throw new TypeError("hex string expected, got " + typeof hex3);
  if (hasHexBuiltin) {
    try {
      return Uint8Array.fromHex(hex3);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex3.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex3.charCodeAt(hi));
    const n2 = asciiToBase16(hex3.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex3[hi] + hex3[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes2(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function checkOpts2(defaults, opts, title = "opts") {
  aopts(defaults, "defaults");
  if (opts !== void 0)
    aopts(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts2({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes2(bytesLength = 32) {
  anumber2(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE3) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE3;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView2(this.buffer);
  }
  update(data) {
    aexists2(this);
    abytes2(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView2(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE3 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE3);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView2(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE3);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and makes sha256 3x slower (measured).
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B: B2, C, D, E, F, G, H: H2 } = this;
    return [A, B2, C, D, E, F, G, H2];
  }
  // prettier-ignore
  set(A, B2, C, D, E, F, G, H2) {
    this.A = A | 0;
    this.B = B2 | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H2 | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B: B2, C, D, E, F, G, H: H2 } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H2 + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B2, C) | 0;
      H2 = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B2;
      B2 = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B2 = B2 + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H2 = H2 + this.H | 0;
    this.set(A, B2, C, D, E, F, G, H2);
  }
  roundClean() {
    clean2(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean2(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);

// vendor/taperelay-client/src/constants.json
var constants_default = {
  description: "\u968F\u534F\u8BAE\u540D\u79F0\u6539\u53D8\u7684\u5E38\u91CF\uFF08\u89C4\u8303\u7684\u5E38\u91CF\u8868\uFF1A\u6587\u4EF6\u683C\u5F0F \xA72\u3001TapeRelay \xA72\u3001TapeStore \xA71\uFF1BI-035\u3001D-052\u3001D-530\uFF09\u3002\u534F\u8BAE\u540D\u79F0\u4E3A TapeRelay\uFF08D-070\u3001D-071\uFF1B\u8FD9\u4E9B\u5E38\u91CF D-081 \u5B9A\u4E0B\uFF0C\u4EE5\u540E\u4E0D\u518D\u6539\uFF09\uFF1B\u9879\u76EE\u540D 2026-10-17 \u8D77\u4E5F\u662F TapeRelay\uFF08D-305\uFF0C\u539F\u540D TapeStore\uFF09\u3002\u8FD9\u91CC\u3001\u90A3\u5F20\u8868\u548C\u89C4\u8303\u6B63\u6587\u91CC\u76F4\u63A5\u5199\u51FA\u8FD9\u4E9B\u503C\u7684\u5730\u65B9\u5FC5\u987B\u4E00\u81F4\uFF1Bspec/check-openapi.mjs \u6838\u5BF9\u8FD9\u91CC\u4E0E\u90A3\u5F20\u8868\u4E00\u81F4\u3002\u6D4B\u8BD5\u5411\u91CF\u811A\u672C\u4ECE\u8FD9\u91CC\u53D6\u503C\u3002",
  eip712DomainName: "TapeRelay",
  protocolId: "taperelay",
  discoveryPath: ".well-known/taperelay.json",
  directoryPath: ".well-known/taperelay/directory",
  envelopeMagic: "TREN",
  keyBackupMagic: "TRKB",
  labels: {
    chunk: "TapeRelay/v1/chunk",
    index: "TapeRelay/v1/index",
    commit: "TapeRelay/v1/commit",
    pair: "TapeRelay/v1/pair"
  },
  manifestContentType: "application/vnd.taperelay.manifest+json",
  directoryContentType: "application/vnd.taperelay.directory+json",
  siteContentType: "application/vnd.taperelay.site+json",
  headerPrefix: "TR-"
};

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/utils.js
function aarray(item, title, inner = () => {
}) {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0; i < item.length; i++)
    inner(item[i], `${title}[${i}]`);
  return item;
}
var abytes3 = (value, length, title) => abytes2(value, length, title);
var anumber3 = anumber2;
function astring(value, title = "") {
  if (typeof value !== "string") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected string, got type=" + typeof value);
  }
  return value;
}
function aobject3(value, title = "object") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function afunction(value, title) {
  if (typeof value !== "function")
    throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
  return value;
}
var bytesToHex2 = bytesToHex;
var concatBytes2 = (...arrays) => concatBytes(...arrays);
var hexToBytes2 = (hex3) => hexToBytes(hex3);
var isBytes3 = isBytes2;
var randomBytes3 = (bytesLength) => randomBytes2(bytesLength);
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
var atitle3 = (title) => title ? `"${title}" ` : "";
function abool3(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle3(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber3(n);
  return n;
}
function asafenumber(value, title = "") {
  if (typeof value !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function numberToHexUnpadded(num) {
  const hex3 = abignumber(num).toString(16);
  return hex3.length & 1 ? "0" + hex3 : hex3;
}
function hexToNumber(hex3) {
  if (typeof hex3 !== "string")
    throw new TypeError("hex string expected, got " + typeof hex3);
  return hex3 === "" ? _0n : BigInt("0x" + hex3);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  return hexToNumber(bytesToHex(copyBytes3(abytes2(bytes)).reverse()));
}
function numberToBytesBE(n, len) {
  anumber2(len);
  if (len === 0)
    throw new Error("zero output length is invalid");
  n = abignumber(n);
  const expectedLen = len * 2;
  const hex3 = n.toString(16);
  if (hex3.length > expectedLen)
    throw new RangeError("number is too large");
  return hexToBytes(hex3.padStart(expectedLen, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function copyBytes3(bytes) {
  return Uint8Array.from(abytes3(bytes));
}
function isPosBig(n) {
  return typeof n === "bigint" && _0n <= n;
}
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  if (n < _0n)
    throw new Error("expected non-negative bigint, got " + n);
  return n === _0n ? 0 : n.toString(2).length;
}
var bitMask = (n) => {
  asafenumber(n, "n");
  return (_1n << BigInt(n)) - _1n;
};
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
  anumber2(hashLen, "hashLen");
  anumber2(qByteLen, "qByteLen");
  if (typeof hmacFn !== "function")
    throw new TypeError("hmacFn must be a function");
  const u8n = (len) => new Uint8Array(len);
  const NULL = Uint8Array.of();
  const byte0 = Uint8Array.of(0);
  const byte1 = Uint8Array.of(1);
  const _maxDrbgIters = 1e3;
  let v = u8n(hashLen);
  let k = u8n(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...msgs) => hmacFn(k, concatBytes2(v, ...msgs));
  const reseed = (seed = NULL) => {
    k = h(byte0, seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(byte1, seed);
    v = h();
  };
  const gen = () => {
    if (i++ >= _maxDrbgIters)
      throw new Error("drbg: tried max amount of iterations");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes2(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = void 0;
    while ((res = pred(gen())) === void 0)
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
function validateObject(object, fields = {}, optFields = {}, title = "object") {
  aobject3(object, title);
  aobject3(fields, "fields");
  aobject3(optFields, "optFields");
  function checkField(fieldName, expectedType, isOpt) {
    const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
    const val = object[fieldName];
    if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== void 0 : expectedType !== "function")) {
      throw new TypeError(`${label} is invalid: expected own property`);
    }
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/abstract/modular.js
var _0n2 = /* @__PURE__ */ BigInt(0);
var _1n2 = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _15n = /* @__PURE__ */ BigInt(15);
var _16n = /* @__PURE__ */ BigInt(16);
var POW_WINDOWED_MIN = /* @__PURE__ */ BigInt("0x10000000000000000");
function mod(a, b) {
  if (b <= _0n2)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow(num, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow: expected modulus > 1, got " + modulo);
  if (typeof power !== "bigint")
    throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return _1n2;
  if (power === _1n2)
    return num;
  let d = num % modulo;
  if (d < _0n2)
    d += modulo;
  if (power < POW_WINDOWED_MIN) {
    let p2 = _1n2;
    while (power > _0n2) {
      if (power & _1n2)
        p2 = p2 * d % modulo;
      d = d * d % modulo;
      power >>= _1n2;
    }
    return p2;
  }
  const digits = [];
  while (power > _0n2) {
    digits.push(Number(power & _15n));
    power >>= _4n;
  }
  const table = new Array(16);
  table[0] = _1n2;
  table[1] = d;
  for (let i = 2; i < 16; i++)
    table[i] = table[i - 1] * d % modulo;
  let p = table[digits[digits.length - 1]];
  for (let w = digits.length - 2; w >= 0; w--) {
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    const digit = digits[w];
    if (digit !== 0)
      p = p * table[digit] % modulo;
  }
  return p;
}
function pow2(x, power, modulo) {
  if (modulo <= _1n2)
    throw new Error("pow2: expected modulus > 1, got " + modulo);
  if (power < _0n2)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _1n2)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, u = _1n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function invertCt(a, prime) {
  if (prime <= _1n2)
    throw new Error("invertCt: expected prime modulus > 1, got " + prime);
  const an = mod(a, prime);
  if (an === _0n2)
    throw new Error("invertCt: expected non-zero number");
  const inverse = pow(an, prime - _2n, prime);
  if (mod(an * inverse, prime) !== _1n2)
    throw new Error("invertCt: does not exist");
  return inverse;
}
function assertIsSquare(Fp, root, n) {
  const F = Fp;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function aoddModulus(order, fnName) {
  if ((order & _1n2) === _0n2)
    throw new Error(fnName + ": expected odd modulus, got " + order);
}
function sqrt3mod4(Fp, n) {
  const F = Fp;
  const p1div4 = (F.ORDER + _1n2) / _4n;
  const root = F.pow(n, p1div4);
  assertIsSquare(F, root, n);
  return root;
}
function sqrt5mod8(Fp, n) {
  const F = Fp;
  const p5div8 = (F.ORDER - _5n) / _8n;
  const n2 = F.mul(n, _2n);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare(F, root, n);
  return root;
}
function sqrt9mod16(P2) {
  const Fp_ = Field(P2);
  const tn = tonelliShanks(P2);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P2 + _7n) / _16n;
  return ((Fp, n) => {
    const F = Fp;
    let tv1 = F.pow(n, c4);
    let tv2 = F.mul(tv1, c1);
    const tv3 = F.mul(tv1, c2);
    const tv4 = F.mul(tv1, c3);
    const e1 = F.eql(F.sqr(tv2), n);
    const e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1);
    tv2 = F.cmov(tv4, tv3, e2);
    const e3 = F.eql(F.sqr(tv2), n);
    const root = F.cmov(tv1, tv2, e3);
    assertIsSquare(F, root, n);
    return root;
  });
}
function tonelliShanks(P2) {
  if (P2 < _3n)
    throw new Error("sqrt is not defined for small field");
  aoddModulus(P2, "tonelliShanks");
  let Q = P2 - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P2);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp, n) {
    const F = Fp;
    if (F.is0(n))
      return n;
    if (FpLegendre(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        throw new Error("Cannot find square root: probably non-prime P");
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P2) {
  aoddModulus(P2, "Fp.sqrt");
  if (P2 % _4n === _3n)
    return sqrt3mod4;
  if (P2 % _8n === _5n)
    return sqrt5mod8;
  if (P2 % _16n === _9n)
    return sqrt9mod16(P2);
  return tonelliShanks(P2);
}
var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n2) === _1n2;
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  aobject3(field, "field");
  if (typeof field.ORDER !== "bigint")
    throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
  asafenumber(field.BYTES, "BYTES");
  asafenumber(field.BITS, "BITS");
  for (const name of FIELD_FIELDS)
    afunction(field[name], "field." + name);
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n2)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpInvertBatch(Fp, nums, passZero = false) {
  validateField(Fp);
  aarray(nums, "nums");
  abool3(passZero, "passZero");
  const F = Fp;
  const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = acc;
    return F.mul(acc, num);
  }, F.ONE);
  const invertedAcc = F.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = F.mul(acc, inverted[i]);
    return F.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp, n) {
  validateField(Fp);
  const F = Fp;
  aoddModulus(F.ORDER, "FpLegendre");
  const p1mod2 = (F.ORDER - _1n2) / _2n;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber3(nBitLength);
  if (n <= _0n2)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n2;
  ONE = _1n2;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _1n2)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength = void 0;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = Object.freeze(opts.allowedLengths.slice());
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num) {
    return mod(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n2 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n2;
  }
  // is valid and invertible
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n2) === _1n2;
  }
  neg(num) {
    return mod(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return pow(num, power, this.ORDER);
  }
  div(lhs, rhs) {
    return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT.get(this);
    if (!sqrt)
      FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
    return sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes3(bytes);
    const { _lengths: allowedLengths, BYTES, isLE: isLE3, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE3 ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE3 ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    if (modFromBytes)
      scalar = mod(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch(this, lst, true);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool3(condition, "condition");
    return condition ? b : a;
  }
};
function Field(ORDER, opts = {}) {
  Object.freeze(_Field.prototype);
  return new _Field(ORDER, opts);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  if (fieldOrder <= _1n2)
    throw new Error("field order must be greater than 1");
  const bitLength = bitLen(fieldOrder - _1n2);
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE3 = false) {
  abytes3(key);
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = Math.max(getMinHashLength(fieldOrder), 16);
  if (len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE3 ? bytesToNumberLE(key) : bytesToNumberBE(key);
  const reduced = mod(num, fieldOrder - _1n2) + _1n2;
  return isLE3 ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/abstract/curve.js
var _0n3 = /* @__PURE__ */ BigInt(0);
var _1n3 = /* @__PURE__ */ BigInt(1);
var _4n2 = /* @__PURE__ */ BigInt(4);
var BLIND_BYTES = 16;
var BLIND_BITS = 128;
var FW_WINDOW = 5;
var TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
function validatePointCons(Point) {
  const pc = Point;
  if (typeof pc !== "function")
    throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
  afunction(pc.fromAffine, "Point.fromAffine");
  afunction(pc.fromBytes, "Point.fromBytes");
  afunction(pc.fromHex, "Point.fromHex");
  aobject3(pc.BASE, "Point.BASE");
  aobject3(pc.ZERO, "Point.ZERO");
  validateField(pc.Fp);
  validateField(pc.Fn);
}
function normalizeZ(c, points) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits, min = 1) {
  if (!Number.isSafeInteger(W) || W < min || W > bits)
    throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
}
function validateTableBytes(numPoints, fpBytes) {
  const bytes = numPoints * (4 * fpBytes + 128);
  if (bytes > TABLE_BYTES_MAX)
    throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX / 2 ** 20 + " MiB");
}
function probeRandomBytes(randomBytes4, length) {
  if (randomBytes4 === void 0)
    return void 0;
  afunction(randomBytes4, "randomBytes");
  try {
    const probe = randomBytes4(length);
    if (!isBytes3(probe) || probe.length !== length)
      return void 0;
  } catch {
    return void 0;
  }
  return randomBytes4;
}
function validateMSMPoints(points, c) {
  aarray(points, "points");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field, maxScalar) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    const ok = maxScalar === void 0 ? field.isValid(s) : isPosBig(s) && s < maxScalar;
    if (!ok)
      throw new Error("invalid scalar at index " + i);
  });
}
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getWindowSize(P2) {
  return pointWindowSizes.get(P2) || 1;
}
function oddMultiples(p, size) {
  const dbl = p.double();
  const t = [p];
  for (let j = 1; j < size; j++)
    t.push(t[j - 1].add(dbl));
  return t;
}
function wnafDigits(n, W) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const d = [];
  while (n > _0n3) {
    let w = 0;
    if (n & _1n3) {
      w = Number(n & mask);
      if (w >= half)
        w -= size;
      n -= BigInt(w);
    }
    d.push(w);
    n >>= _1n3;
  }
  return d;
}
function signedWindowDigits(n, W, windows) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const shiftBy = BigInt(W);
  const d = [];
  for (let w = 0; w < windows; w++) {
    let v = Number(n & mask);
    n >>= shiftBy;
    if (v > half) {
      v -= size;
      n += _1n3;
    }
    d.push(v);
  }
  if (n !== _0n3)
    throw new Error("invalid wnaf");
  return d;
}
function wnafWalk(zero, tables, digits) {
  let max = 0;
  for (const d of digits)
    max = Math.max(max, d.length);
  let acc = zero;
  for (let bit = max - 1; bit >= 0; bit--) {
    if (bit !== max - 1)
      acc = acc.double();
    for (let i = 0; i < digits.length; i++) {
      const w = digits[i][bit];
      if (w) {
        const item = tables[i][Math.abs(w) - 1 >> 1];
        acc = acc.add(w < 0 ? item.negate() : item);
      }
    }
  }
  return acc;
}
var ScalarMultiplier = class {
  Point;
  BASE;
  ZERO;
  randomBytes;
  wnafPrecomputes = /* @__PURE__ */ new WeakMap();
  baseCanBeBlinded;
  bits;
  // Parametrized with a given Point class (not individual point)
  constructor(Point, randomBytes4) {
    validatePointCons(Point);
    this.randomBytes = probeRandomBytes(randomBytes4, BLIND_BYTES);
    this.Point = Point;
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.bits = Point.Fn.BITS;
  }
  /**
   * Creates a signed fixed-window wNAF precomputation table: for every window w, the
   * multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
   * so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
   * window absorbs the final carry of signed-digit recoding.
   * For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
   * @param point - Point instance
   * @param W - window size
   * @param bits - scalar bitlength the table must cover
   */
  buildWnafTable(point, W, bits) {
    const windows = Math.ceil(bits / W) + 1;
    const half = 2 ** (W - 1);
    const comp = [];
    let base = point;
    for (let w = 0; w < windows; w++) {
      let acc = base;
      for (let i = 0; i < half; i++) {
        comp.push(acc);
        acc = acc.add(base);
      }
      base = comp[comp.length - 1].double();
    }
    return { W, bits, windows, comp };
  }
  /**
   * Implements ec multiplication using precomputed signed fixed-window wNAF tables.
   * Constant-time: fixed window count with one table addition per window — zero digits feed
   * the fake accumulator — and no doublings; the lookup scans the whole window slice.
   * Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
   * {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
   * signedWindowDigits throws if `n` exceeds the table.
   * @returns real and fake (for const-time) points
   */
  wnafCachedCT(precomputes, n) {
    const { W, windows, comp } = precomputes;
    const half = 2 ** (W - 1);
    const digits = signedWindowDigits(n, W, windows);
    let p = this.ZERO;
    let f = this.BASE;
    for (let w = 0; w < windows; w++) {
      const digit = digits[w];
      const start = w * half;
      const idx = Math.abs(digit) - 1;
      let sel = comp[start];
      for (let i = 1; i < half; i++)
        sel = i === idx ? comp[start + i] : sel;
      const neg = sel.negate();
      if (digit === 0)
        f = f.add(comp[start]);
      else
        p = p.add(digit < 0 ? neg : sel);
    }
    return { p, f };
  }
  // Cache key is point identity plus (W, bits); at most two entries exist per point (public-width
  // `Fn.BITS` and blinded `Fn.BITS + BLIND_BITS`). Callers must not reuse the same point with
  // incompatible `transform(...)` layouts and expect a separate cache entry.
  getWnafPrecomputes(W, point, bits, transform) {
    let entries = this.wnafPrecomputes.get(point);
    let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
    if (!comp) {
      comp = this.buildWnafTable(point, W, bits);
      if (typeof transform === "function")
        comp = { ...comp, comp: transform(comp.comp) };
      if (!entries) {
        entries = [];
        this.wnafPrecomputes.set(point, entries);
      }
      entries.push(comp);
    }
    return comp;
  }
  assertPoint(point) {
    if (!(point instanceof this.Point))
      throw new TypeError('"point" expected Point instance, got type=' + typeof point);
  }
  // Shared prologue of the constant-time entry points. Rejects scalar 0: in key/signature-style
  // callers a zero scalar means broken upstream plumbing, and concrete Points already reject it.
  // Uses inRange instead of Fn.isValidNot0: validateField() only certifies the arithmetic subset.
  validateMulInput(point, scalar) {
    this.assertPoint(point);
    if (!inRange(scalar, _1n3, this.Point.Fn.ORDER))
      throw new Error("invalid scalar");
  }
  // Constant-time dispatch shared by mulCT / mulCTBlinded. Un-precomputed points (W===1, e.g.
  // ECDH peer keys) skip building a throwaway cached table in favor of a small fixed-window
  // multiply. `n` must be < 2^bits.
  runCT(point, n, bits, transform) {
    const W = getWindowSize(point);
    if (W === 1)
      return this.fixedWindowCT(point, n, bits);
    return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
  }
  mulCT(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    return this.runCT(point, scalar, this.bits, transform);
  }
  mulCTBlinded(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    if (this.randomBytes === void 0)
      throw new Error("randomBytes is required for scalar blinding");
    const bits = this.Point.Fn.BITS + BLIND_BITS;
    const blind = this.randomBytes(BLIND_BYTES);
    if (!isBytes3(blind) || blind.length !== BLIND_BYTES)
      throw new Error("randomBytes returned invalid byte array");
    blind[0] = blind[0] & 63 | 128;
    const n = scalar + bytesToNumberBE(blind) * this.Point.Fn.ORDER;
    return this.runCT(point, n, bits, transform);
  }
  /**
   * Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
   * A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
   * far cheaper to build for a single use. The point-operation sequence is independent of `n`:
   * build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
   * every table entry, and one addition (adds the identity when the window digit is 0 — never
   * skipped).
   *
   * `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
   * add), which holds for the Weierstrass/Edwards point types used here. The table is left in
   * projective form (no normalizeZ): normalizing this small a table costs more than the
   * mixed-add savings it would buy for a single multiply.
   * @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
   * (this path needs no fake accumulator — its op-count is already scalar-independent).
   */
  fixedWindowCT(point, n, bits) {
    const W = FW_WINDOW;
    const size = 1 << W;
    const mask = bitMask(W);
    const table = new Array(size);
    table[0] = this.ZERO;
    for (let i = 1; i < size; i++)
      table[i] = table[i - 1].add(point);
    const windows = Math.ceil(bits / W);
    let acc = this.ZERO;
    for (let window = windows - 1; window >= 0; window--) {
      if (window !== windows - 1)
        for (let d = 0; d < W; d++)
          acc = acc.double();
      const digit = Number(n >> BigInt(window * W) & mask);
      let sel = table[0];
      for (let i = 1; i < size; i++)
        sel = i === digit ? table[i] : sel;
      acc = acc.add(sel);
    }
    return { p: acc, f: acc };
  }
  shouldBlind(point, cofactor) {
    if (this.randomBytes === void 0)
      return false;
    if (cofactor === _1n3)
      return true;
    if (point !== this.BASE)
      return false;
    if (this.baseCanBeBlinded === void 0)
      this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
    return this.baseCanBeBlinded;
  }
  mulSecret(point, scalar, cofactor, transform) {
    return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
  }
  mulUnsafe(point, scalar, transform) {
    this.assertPoint(point);
    if (!isPosBig(scalar))
      throw new Error("invalid scalar");
    const W = getWindowSize(point);
    if (W === 1 || scalar >= this.Point.Fn.ORDER)
      return mulAddUnsafe(this.Point, [point], [scalar], true);
    const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
    return this.wnafCachedCT(precomputes, scalar).p;
  }
  // Remembers the window size used for precomputed wNAF multiplication of the given point
  // and drops any previously built tables. Usually only the base point is precomputed.
  // W=1 resets the point to the un-precomputed (table-less) paths.
  // W is additionally capped so tables stay under ~2 GiB ({@link TABLE_BYTES_MAX}).
  setWindowSize(point, W) {
    this.assertPoint(point);
    validateW(W, this.bits);
    const windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
    validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
    pointWindowSizes.set(point, W);
    this.wnafPrecomputes.delete(point);
  }
  // True when a window size is set: tables themselves are built lazily on first multiply.
  hasWindowSize(point) {
    return getWindowSize(point) !== 1;
  }
};
function mulAddUnsafe(c, points, scalars, allowOversized = false) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  abool3(allowOversized, "allowOversized");
  validateMSMScalars(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n2 : void 0);
  if (points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  const tables = points.map((p) => oddMultiples(p, 4));
  const digits = scalars.map((n) => wnafDigits(n, 4));
  return wnafWalk(c.ZERO, tables, digits);
}
function createField(order, field, isLE3) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE: isLE3 });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (type !== "weierstrass" && type !== "edwards")
    throw new Error('expected curve type "weierstrass" or "edwards"');
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  validateObject(curveOpts);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(isPosBig(val) && val !== _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp, Fn };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/hmac.js
var _HMAC = class {
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash(hash);
    abytes2(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("expected Hash instance");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean2(pad);
  }
  update(buf) {
    aexists2(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const buf = out.subarray(0, this.outputLen);
    this.iHash.digestInto(buf);
    this.oHash.update(buf);
    this.oHash.digestInto(buf);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to ||= Object.create(Object.getPrototypeOf(this), {});
    const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.canXOF = canXOF;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = /* @__PURE__ */ (() => {
  const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
  hmac_.create = (hash, key) => new _HMAC(hash, key);
  return hmac_;
})();

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/abstract/der.js
var _0n4 = /* @__PURE__ */ BigInt(0);
var DERErr = class extends Error {
  constructor(m = "") {
    super(m);
  }
};
var _DER = {
  // asn.1 DER encoding utils
  Err: DERErr,
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (tag, data) => {
      const { Err: E } = _DER;
      asafenumber(tag, "tag");
      if (tag < 0 || tag > 255)
        throw new E("tlv.encode: wrong tag");
      astring(data, "data");
      if (data.length & 1)
        throw new E("tlv.encode: unpadded data");
      const dataLen = data.length / 2;
      const len = numberToHexUnpadded(dataLen);
      if (len.length / 2 & 128)
        throw new E("tlv.encode: long form length too big");
      const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
      const t = numberToHexUnpadded(tag);
      return t + lenLen + len + data;
    },
    // v - value, l - left bytes (unparsed)
    decode(tag, data) {
      const { Err: E } = _DER;
      data = abytes3(data, void 0, "DER data");
      let pos = 0;
      if (tag < 0 || tag > 255)
        throw new E("tlv.decode: wrong tag");
      if (data.length < 2 || data[pos++] !== tag)
        throw new E("tlv.decode: wrong tlv");
      const first = data[pos++];
      const isLong = !!(first & 128);
      let length = 0;
      if (!isLong)
        length = first;
      else {
        const lenLen = first & 127;
        if (!lenLen)
          throw new E("tlv.decode(long): indefinite length not supported");
        if (lenLen > 4)
          throw new E("tlv.decode(long): byte length is too big");
        const lengthBytes = data.subarray(pos, pos + lenLen);
        if (lengthBytes.length !== lenLen)
          throw new E("tlv.decode: length bytes not complete");
        if (lengthBytes[0] === 0)
          throw new E("tlv.decode(long): zero leftmost byte");
        for (const b of lengthBytes)
          length = length << 8 | b;
        pos += lenLen;
        if (length < 128)
          throw new E("tlv.decode(long): not minimal encoding");
      }
      const v = data.subarray(pos, pos + length);
      if (v.length !== length)
        throw new E("tlv.decode: wrong value length");
      return { v, l: data.subarray(pos + length) };
    }
  },
  // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
  // since we always use positive integers here. It must always be empty:
  // - add zero byte if exists
  // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
  _int: {
    encode(num) {
      const { Err: E } = _DER;
      abignumber(num);
      if (num < _0n4)
        throw new E("integer: negative integers are not allowed");
      let hex3 = numberToHexUnpadded(num);
      if (Number.parseInt(hex3[0], 16) & 8)
        hex3 = "00" + hex3;
      if (hex3.length & 1)
        throw new E("unexpected DER parsing assertion: unpadded hex");
      return hex3;
    },
    decode(data) {
      const { Err: E } = _DER;
      if (data.length < 1)
        throw new E("invalid signature integer: empty");
      if (data[0] & 128)
        throw new E("invalid signature integer: negative");
      if (data.length > 1 && data[0] === 0 && !(data[1] & 128))
        throw new E("invalid signature integer: unnecessary leading zero");
      return bytesToNumberBE(data);
    }
  },
  toSig(bytes, maxScalarBytes) {
    const { Err: E, _int: int, _tlv: tlv } = _DER;
    if (maxScalarBytes !== void 0) {
      asafenumber(maxScalarBytes, "maxScalarBytes");
      if (maxScalarBytes < 1)
        throw new E("invalid signature: maxScalarBytes must be positive");
    }
    const data = abytes3(bytes, void 0, "signature");
    const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
    if (seqLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
    const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
    if (sLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    if (maxScalarBytes !== void 0 && (rBytes.length > maxScalarBytes || sBytes.length > maxScalarBytes))
      throw new E("invalid signature: integer too large");
    return { r: int.decode(rBytes), s: int.decode(sBytes) };
  },
  hexFromSig(sig) {
    const { _tlv: tlv, _int: int } = _DER;
    validateObject(sig, { r: "bigint", s: "bigint" }, {}, "sig");
    const rs = tlv.encode(2, int.encode(sig.r));
    const ss = tlv.encode(2, int.encode(sig.s));
    const seq = rs + ss;
    return tlv.encode(48, seq);
  }
};
var DER = /* @__PURE__ */ (() => {
  Object.freeze(_DER._tlv);
  Object.freeze(_DER._int);
  return Object.freeze(_DER);
})();

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/abstract/weierstrass.js
var divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n2) / den;
function _splitEndoScalar(k, basis, n) {
  aInRange("scalar", k, _0n5, n);
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n5;
  const k2neg = k2 < _0n5;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n4;
  if (k1 < _0n5 || k1 >= MAX_NUM || k2 < _0n5 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed for k");
  }
  return { k1neg, k1, k2neg, k2 };
}
function validateSigFormat(format) {
  if (!["compact", "recovered", "der"].includes(format))
    throw new Error('Signature format must be "compact", "recovered", or "der"');
  return format;
}
function validateSigOpts(opts, def) {
  validateObject(opts);
  const optsn = {};
  for (let optName of Object.keys(def)) {
    optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
  }
  abool3(optsn.lowS, "lowS");
  abool3(optsn.prehash, "prehash");
  if (optsn.format !== void 0)
    validateSigFormat(optsn.format);
  return optsn;
}
var _0n5 = /* @__PURE__ */ BigInt(0);
var _1n4 = /* @__PURE__ */ BigInt(1);
var _2n2 = /* @__PURE__ */ BigInt(2);
var _3n2 = /* @__PURE__ */ BigInt(3);
var _4n3 = /* @__PURE__ */ BigInt(4);
function weierstrass(params, extraOpts = {}) {
  const validated = createCurveFields("weierstrass", params, extraOpts);
  const Fp = validated.Fp;
  const Fn = validated.Fn;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  validateObject(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object",
    randomBytes: "function"
  });
  const { endo: endoOpts, allowInfinityPoint, clearCofactor, isTorsionFree, fromBytes, toBytes } = extraOpts;
  const randomBytes4 = extraOpts.randomBytes === void 0 ? randomBytes3 : extraOpts.randomBytes;
  if (endoOpts) {
    if (!Fp.is0(CURVE.a) || typeof endoOpts.beta !== "bigint" || !Array.isArray(endoOpts.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const endo = endoOpts ? {
    beta: endoOpts.beta,
    basises: endoOpts.basises.map((basis) => [...basis])
  } : void 0;
  const lengths = getWLengths(Fp, Fn);
  function assertCompressionIsSupported() {
    if (!Fp.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes(_c, point, isCompressed) {
    if (point.is0()) {
      if (!allowInfinityPoint)
        throw new Error("bad point: ZERO");
      return Uint8Array.of(0);
    }
    const { x, y } = point.toAffine();
    const bx = Fp.toBytes(x);
    abool3(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp.isOdd(y);
      return concatBytes2(pprefix(hasEvenY), bx);
    } else {
      return concatBytes2(Uint8Array.of(4), bx, Fp.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    abytes3(bytes, void 0, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (allowInfinityPoint && length === 1 && head === 0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (length === comp && (head === 2 || head === 3)) {
      const x = Fp.fromBytes(tail);
      if (!Fp.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp.sqrt(y2);
      } catch (sqrtError) {
        const err2 = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err2);
      }
      assertCompressionIsSupported();
      const evenY = Fp.isOdd(y);
      const evenH = (head & 1) === 1;
      if (evenH !== evenY)
        y = Fp.neg(y);
      return { x, y };
    } else if (length === uncomp && head === 4) {
      const L = Fp.BYTES;
      const x = Fp.fromBytes(tail.subarray(0, L));
      const y = Fp.fromBytes(tail.subarray(L, L * 2));
      if (!isValidXY(x, y))
        throw new Error("bad point: is not on curve");
      return { x, y };
    } else {
      throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
    }
  }
  const encodePoint = toBytes === void 0 ? pointToBytes : toBytes;
  const decodePoint = fromBytes === void 0 ? pointFromBytes : fromBytes;
  const b3 = Fp.mul(CURVE.b, _3n2);
  const mulA = Fp.is0(CURVE.a) ? (_) => Fp.ZERO : (x) => Fp.mul(CURVE.a, x);
  function weierstrassEquation(x) {
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    return Fp.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n2), _4n3);
  const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
  if (Fp.is0(Fp.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp.isValid(n) || banZero && Fp.is0(n))
      throw new Error(`bad point coordinate ${title}`);
    return typeof n === "object" && n !== null ? Fp.create(n) : n;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("Weierstrass Point expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar(k, endo.basises, Fn.ORDER);
  }
  function pushWnafPair(points, scalars, p, k) {
    if (!Fn.isValid(k))
      throw new RangeError("invalid scalar: out of range");
    if (endo) {
      const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(k);
      const psi = new Point(Fp.mul(p.X, endo.beta), p.Y, p.Z);
      points.push(k1neg ? p.negate() : p, k2neg ? psi.negate() : psi);
      scalars.push(k1, k2);
    } else {
      points.push(p);
      scalars.push(k);
    }
  }
  const validityCache = /* @__PURE__ */ new WeakSet();
  class Point {
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
    static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
    static Fp = Fp;
    static Fn = Fn;
    X;
    Y;
    Z;
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    constructor(X, Y, Z) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y, true);
      this.Z = acoord("z", Z);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp.is0(x) && Fp.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp.ONE);
    }
    static fromBytes(bytes) {
      const P2 = Point.fromAffine(decodePoint(abytes3(bytes, void 0, "point")));
      P2.assertValidity();
      return P2;
    }
    static fromHex(hex3) {
      return Point.fromBytes(hexToBytes2(hex3));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     * @param isLazy - true will defer table computation until the first multiplication
     */
    precompute(windowSize = 6, isLazy = true) {
      wnaf.setWindowSize(this, windowSize);
      if (!isLazy)
        this.multiply(_3n2);
      return this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      const p = this;
      if (p.is0()) {
        if (allowInfinityPoint && Fp.is0(p.X) && Fp.eql(p.Y, Fp.ONE) && Fp.is0(p.Z))
          return;
        throw new Error("bad point: ZERO");
      }
      if (validityCache.has(p))
        return;
      const { x, y } = p.toAffine();
      if (!Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("bad point: x or y not field elements");
      if (!isValidXY(x, y))
        throw new Error("bad point: equation left != right");
      if (!p.isTorsionFree())
        throw new Error("bad point: not in prime-order subgroup");
      validityCache.add(p);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp.isOdd(y);
    }
    /** Compare one point to another. */
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
    negate() {
      return new Point(this.X, Fp.neg(this.Y), this.Z);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = mulA(Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = mulA(t2);
      t3 = Fp.sub(t0, t2);
      t3 = mulA(t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = mulA(t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = mulA(t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = mulA(t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      aprjpoint(other);
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    /**
     * Constant time multiplication.
     * Uses precomputed tables (signed fixed-window wNAF) when available.
     * Uses scalar blinding and avoids endomorphism splitting in the secret-scalar path.
     * @param scalar - by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new RangeError("invalid scalar: out of range");
      const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    /**
     * Non-constant-time multiplication. Uses width-4 wNAF with GLV endomorphism splitting
     * when available (two half-width scalars sharing one halved doubling chain).
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(scalar) {
      const p = this;
      const sc = scalar;
      if (!Fn.isValid(sc))
        throw new RangeError("invalid scalar: out of range");
      if (sc === _0n5 || p.is0())
        return Point.ZERO;
      if (sc === _1n4)
        return p;
      if (wnaf.hasWindowSize(this))
        return wnaf.mulUnsafe(p, sc, normalize);
      const points = [];
      const scalars = [];
      pushWnafPair(points, scalars, p, sc);
      return mulAddUnsafe(Point, points, scalars);
    }
    /**
     * Non-constant-time double-scalar multiplication `a⋅this + b⋅other` (Strauss–Shamir).
     * Both walks share one doubling chain via {@link mulAddUnsafe}, and GLV endomorphism
     * (when available) halves the chain again by splitting each scalar into two half-width
     * parts. Used by ECDSA verification and public-key recovery for `R = u1⋅G + u2⋅P`.
     * Only for public scalars.
     */
    mulAddUnsafe(a, other, b) {
      aprjpoint(other);
      const points = [];
      const scalars = [];
      pushWnafPair(points, scalars, this, a);
      pushWnafPair(points, scalars, other, b);
      return mulAddUnsafe(Point, points, scalars);
    }
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * (X, Y, Z) ∋ (x=X/Z, y=Y/Z).
     * @param invertedZ - Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      if (iz != null && !Fp.isValid(iz))
        throw new RangeError('"invertedZ" expected valid field element');
      const { X, Y, Z } = p;
      if (Fp.eql(Z, Fp.ONE))
        return { x: X, y: Y };
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.ONE : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ZERO };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      if (cofactor === _1n4)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.mulUnsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      if (cofactor === _1n4)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      if (cofactor === _1n4)
        return this.is0();
      return this.clearCofactor().is0();
    }
    toBytes(isCompressed = true) {
      abool3(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex2(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const normalize = (points) => normalizeZ(Point, points);
  const wnaf = new ScalarMultiplier(Point, randomBytes4);
  if (wnaf.bits >= 6)
    Point.BASE.precompute(6);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}
function pprefix(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function getWLengths(Fp, Fn) {
  return {
    secretKey: Fn.BYTES,
    publicKey: 1 + Fp.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp.BYTES,
    publicKeyHasPrefix: true,
    // Raw compact `(r || s)` signature width; DER and recovered signatures use
    // different lengths outside this helper.
    signature: 2 * Fn.BYTES
  };
}
function ecdh(Point, ecdhOpts = {}) {
  validatePointCons(Point);
  const { Fn } = Point;
  const randomBytes_ = ecdhOpts.randomBytes === void 0 ? randomBytes3 : ecdhOpts.randomBytes;
  const lengths = Object.assign(getWLengths(Point.Fp, Fn), {
    seed: Math.max(getMinHashLength(Fn.ORDER), 16)
  });
  function isValidSecretKey(secretKey) {
    try {
      const num = Fn.fromBytes(secretKey);
      return Fn.isValidNot0(num);
    } catch (error) {
      return false;
    }
  }
  function isValidPublicKey(publicKey, isCompressed) {
    const { publicKey: comp, publicKeyUncompressed } = lengths;
    try {
      const l = publicKey.length;
      if (isCompressed === true && l !== comp)
        return false;
      if (isCompressed === false && l !== publicKeyUncompressed)
        return false;
      return !Point.fromBytes(publicKey).is0();
    } catch (error) {
      return false;
    }
  }
  function randomSecretKey(seed) {
    seed = seed === void 0 ? randomBytes_(lengths.seed) : seed;
    return mapHashToField(abytes3(seed, lengths.seed, "seed"), Fn.ORDER);
  }
  function getPublicKey(secretKey, isCompressed = true) {
    return Point.BASE.multiply(Fn.fromBytes(secretKey)).toBytes(isCompressed);
  }
  function isProbPub(item) {
    const { secretKey, publicKey, publicKeyUncompressed } = lengths;
    const allowedLengths = Fn._lengths;
    if (!isBytes3(item))
      return void 0;
    const l = abytes3(item, void 0, "key").length;
    const isPub = l === publicKey || l === publicKeyUncompressed;
    const isSec = l === secretKey || !!allowedLengths?.includes(l);
    if (isPub && isSec)
      return void 0;
    return isPub;
  }
  function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
    if (isProbPub(secretKeyA) === true)
      throw new Error("first arg must be private key");
    if (isProbPub(publicKeyB) === false)
      throw new Error("second arg must be public key");
    const s = Fn.fromBytes(secretKeyA);
    const b = Point.fromBytes(publicKeyB);
    if (b.is0())
      throw new Error("invalid public key: point at infinity");
    return b.multiply(s).toBytes(isCompressed);
  }
  const utils = {
    isValidSecretKey,
    isValidPublicKey,
    randomSecretKey
  };
  const keygen = createKeygen(randomSecretKey, getPublicKey);
  Object.freeze(utils);
  Object.freeze(lengths);
  return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
}
function ecdsa(Point, hash, ecdsaOpts = {}) {
  validatePointCons(Point);
  const hash_ = hash;
  ahash(hash_);
  validateObject(ecdsaOpts, {}, {
    hmac: "function",
    lowS: "boolean",
    randomBytes: "function",
    bits2int: "function",
    bits2int_modN: "function"
  });
  const opts = Object.assign({}, ecdsaOpts);
  const randomBytes4 = opts.randomBytes === void 0 ? randomBytes3 : opts.randomBytes;
  const hmac2 = opts.hmac === void 0 ? (key, msg) => hmac(hash_, key, msg) : opts.hmac;
  const { Fp, Fn } = Point;
  const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
  const blindLength = getMinHashLength(CURVE_ORDER);
  const csprng = probeRandomBytes(randomBytes4, blindLength);
  const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, opts);
  const defaultSigOpts = {
    prehash: true,
    lowS: typeof opts.lowS === "boolean" ? opts.lowS : true,
    format: "compact",
    extraEntropy: false
  };
  const hasLargeRecoveryLifts = CURVE_ORDER * _2n2 + _1n4 < Fp.ORDER;
  function isBiggerThanHalfOrder(number) {
    const HALF = CURVE_ORDER >> _1n4;
    return number > HALF;
  }
  function validateRS(title, num) {
    if (!Fn.isValidNot0(num))
      throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
    return num;
  }
  function assertFieldSignIsSupported() {
    if (!Fp.isOdd)
      throw new Error("Field doesn't support isOdd");
  }
  function getRecoveryBit(x, y, r) {
    assertFieldSignIsSupported();
    return (x === r ? 0 : 2) | Number(Fp.isOdd(y));
  }
  function assertRecoverableCurve() {
    if (hasLargeRecoveryLifts)
      throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
  }
  function validateSigLength(bytes, format) {
    validateSigFormat(format);
    const size = lengths.signature;
    const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : void 0;
    return abytes3(bytes, sizer);
  }
  class Signature {
    r;
    s;
    recovery;
    constructor(r, s, recovery) {
      this.r = validateRS("r", r);
      this.s = validateRS("s", s);
      if (recovery != null) {
        assertRecoverableCurve();
        if (![0, 1, 2, 3].includes(recovery))
          throw new Error("invalid recovery id");
        this.recovery = recovery;
      }
      Object.freeze(this);
    }
    static fromBytes(bytes, format = defaultSigOpts.format) {
      validateSigLength(bytes, format);
      let recid;
      if (format === "der") {
        if (bytes.length > 2 * Fn.BYTES + 16)
          throw new DER.Err("invalid signature: DER signature too long");
        const { r: r2, s: s2 } = DER.toSig(abytes3(bytes), Fn.BYTES + 1);
        return new Signature(r2, s2);
      }
      if (format === "recovered") {
        recid = bytes[0];
        format = "compact";
        bytes = bytes.subarray(1);
      }
      const L = lengths.signature / 2;
      const r = bytes.subarray(0, L);
      const s = bytes.subarray(L, L * 2);
      return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
    }
    static fromHex(hex3, format) {
      return this.fromBytes(hexToBytes2(hex3), format);
    }
    assertRecovery() {
      const { recovery } = this;
      if (recovery == null)
        throw new Error("invalid recovery id: must be present");
      return recovery;
    }
    addRecoveryBit(recovery) {
      return new Signature(this.r, this.s, recovery);
    }
    // Unlike the top-level helper below, this method expects a digest that has
    // already been hashed to the curve's message representative.
    recoverPublicKey(messageHash) {
      const { r, s } = this;
      const recovery = this.assertRecovery();
      const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
      if (!Fp.isValid(radj))
        throw new Error("invalid recovery id: sig.r+curve.n != R.x");
      const x = Fp.toBytes(radj);
      const R = Point.fromBytes(concatBytes2(pprefix((recovery & 1) === 0), x));
      const ir = Fn.inv(radj);
      const h = bits2int_modN(abytes3(messageHash, void 0, "msgHash"));
      const u1 = Fn.create(-h * ir);
      const u2 = Fn.create(s * ir);
      const Q = Point.BASE.mulAddUnsafe(u1, R, u2);
      if (Q.is0())
        throw new Error("invalid recovery: point at infinify");
      Q.assertValidity();
      return Q;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    toBytes(format = defaultSigOpts.format) {
      validateSigFormat(format);
      if (format === "der")
        return hexToBytes2(DER.hexFromSig(this));
      const { r, s } = this;
      const rb = Fn.toBytes(r);
      const sb = Fn.toBytes(s);
      if (format === "recovered") {
        assertRecoverableCurve();
        return concatBytes2(Uint8Array.of(this.assertRecovery()), rb, sb);
      }
      return concatBytes2(rb, sb);
    }
    toHex(format) {
      return bytesToHex2(this.toBytes(format));
    }
  }
  Object.freeze(Signature.prototype);
  Object.freeze(Signature);
  const bits2int = opts.bits2int === void 0 ? function bits2int_def(bytes) {
    if (bytes.length > 8192)
      throw new Error("input is too large");
    const num = bytesToNumberBE(bytes);
    const delta = bytes.length * 8 - fnBits;
    return delta > 0 ? num >> BigInt(delta) : num;
  } : opts.bits2int;
  const bits2int_modN = opts.bits2int_modN === void 0 ? function bits2int_modN_def(bytes) {
    return Fn.create(bits2int(bytes));
  } : opts.bits2int_modN;
  const ORDER_MASK = bitMask(fnBits);
  function int2octets(num) {
    aInRange("num < 2^" + fnBits, num, _0n5, ORDER_MASK);
    return Fn.toBytes(num);
  }
  function validateMsgAndHash(message, prehash) {
    abytes3(message, void 0, "message");
    return prehash ? abytes3(hash_(message), void 0, "prehashed message") : message;
  }
  function prepSig(message, secretKey, opts2) {
    const { lowS, prehash, extraEntropy } = validateSigOpts(opts2, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    const h1int = bits2int_modN(message);
    const d = Fn.fromBytes(secretKey);
    if (!Fn.isValidNot0(d))
      throw new Error("invalid private key");
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (extraEntropy != null && extraEntropy !== false) {
      const e = extraEntropy === true ? randomBytes4(lengths.secretKey) : extraEntropy;
      seedArgs.push(abytes3(e, void 0, "extraEntropy"));
    }
    const seed = concatBytes2(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int(kBytes);
      if (!Fn.isValidNot0(k))
        return;
      const q = Point.BASE.multiply(k).toAffine();
      const r = Fn.create(q.x);
      if (r === _0n5)
        return;
      let s;
      if (csprng !== void 0) {
        const b = bytesToNumberBE(mapHashToField(csprng(blindLength), CURVE_ORDER));
        const ibk = Fn.inv(Fn.mul(b, k));
        const bm = Fn.mul(b, m);
        const bd = Fn.mul(b, d);
        s = Fn.create(ibk * Fn.create(bm + bd * r));
      } else {
        const ik = invertCt(k, CURVE_ORDER);
        s = Fn.create(ik * Fn.create(m + r * d));
      }
      if (s === _0n5)
        return;
      let recovery = getRecoveryBit(q.x, q.y, r);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = Fn.neg(s);
        recovery ^= 1;
      }
      return new Signature(r, normS, hasLargeRecoveryLifts ? void 0 : recovery);
    }
    return { seed, k2sig };
  }
  function sign(message, secretKey, opts2 = {}) {
    const { seed, k2sig } = prepSig(message, secretKey, opts2);
    const drbg = createHmacDrbg(hash_.outputLen, Fn.BYTES, hmac2);
    const sig = drbg(seed, k2sig);
    return sig.toBytes(opts2.format);
  }
  function verify(signature, message, publicKey, opts2 = {}) {
    const { lowS, prehash, format } = validateSigOpts(opts2, defaultSigOpts);
    publicKey = abytes3(publicKey, void 0, "publicKey");
    message = validateMsgAndHash(message, prehash);
    if (!isBytes3(signature)) {
      const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
      throw new Error("verify expects Uint8Array signature" + end);
    }
    validateSigLength(signature, format);
    try {
      const sig = Signature.fromBytes(signature, format);
      const P2 = Point.fromBytes(publicKey);
      if (P2.is0())
        return false;
      if (lowS && sig.hasHighS())
        return false;
      const { r, s } = sig;
      const h = bits2int_modN(message);
      const is = Fn.inv(s);
      const u1 = Fn.create(h * is);
      const u2 = Fn.create(r * is);
      const R = Point.BASE.mulAddUnsafe(u1, P2, u2);
      if (R.is0())
        return false;
      const q = R.toAffine();
      const v = Fn.create(q.x);
      if (v !== r)
        return false;
      if (format === "recovered" && sig.recovery !== getRecoveryBit(q.x, q.y, r))
        return false;
      return true;
    } catch (e) {
      return false;
    }
  }
  function recoverPublicKey(signature, message, opts2 = {}) {
    const { prehash } = validateSigOpts(opts2, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
  }
  return Object.freeze({
    keygen,
    getPublicKey,
    getSharedSecret,
    utils,
    lengths,
    Point,
    sign,
    verify,
    recoverPublicKey,
    Signature,
    hash: hash_
  });
}

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/secp256k1.js
var secp256k1_CURVE = {
  p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
  n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
  h: BigInt(1),
  a: BigInt(0),
  b: BigInt(7),
  Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
  Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
};
var secp256k1_ENDO = {
  beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
  basises: [
    [BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],
    [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]
  ]
};
var _2n3 = /* @__PURE__ */ BigInt(2);
function sqrtMod(y) {
  const P2 = secp256k1_CURVE.p;
  const _3n4 = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
  const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
  const b2 = y * y * y % P2;
  const b3 = b2 * b2 * y % P2;
  const b6 = pow2(b3, _3n4, P2) * b3 % P2;
  const b9 = pow2(b6, _3n4, P2) * b3 % P2;
  const b11 = pow2(b9, _2n3, P2) * b2 % P2;
  const b22 = pow2(b11, _11n, P2) * b11 % P2;
  const b44 = pow2(b22, _22n, P2) * b22 % P2;
  const b88 = pow2(b44, _44n, P2) * b44 % P2;
  const b176 = pow2(b88, _88n, P2) * b88 % P2;
  const b220 = pow2(b176, _44n, P2) * b44 % P2;
  const b223 = pow2(b220, _3n4, P2) * b3 % P2;
  const t1 = pow2(b223, _23n, P2) * b22 % P2;
  const t2 = pow2(t1, _6n, P2) * b2 % P2;
  const root = pow2(t2, _2n3, P2);
  if (!Fpk1.eql(Fpk1.sqr(root), y))
    throw new Error("Cannot find square root");
  return root;
}
var Fpk1 = /* @__PURE__ */ Field(secp256k1_CURVE.p, { sqrt: sqrtMod });
var Pointk1 = /* @__PURE__ */ weierstrass(secp256k1_CURVE, {
  Fp: Fpk1,
  endo: secp256k1_ENDO
});
var secp256k1 = /* @__PURE__ */ ecdsa(Pointk1, sha256);

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/sha3.js
var _0n6 = BigInt(0);
var _1n5 = BigInt(1);
var _2n4 = BigInt(2);
var _7n2 = BigInt(7);
var _256n = BigInt(256);
var _0x71n = BigInt(113);
var SHA3_PI = [];
var SHA3_ROTL = [];
var _SHA3_IOTA = [];
for (let round = 0, R = _1n5, x = 1, y = 0; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
  let t = _0n6;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n5 ^ (R >> _7n2) * _0x71n) % _256n;
    if (R & _2n4)
      t ^= _1n5 << (_1n5 << BigInt(j)) - _1n5;
  }
  _SHA3_IOTA.push(t);
}
var IOTAS = split(_SHA3_IOTA, true);
var SHA3_IOTA_H = IOTAS[0];
var SHA3_IOTA_L = IOTAS[1];
var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
var B = new Uint32Array(5 * 2);
function keccakP(s, rounds = 24) {
  if (!(s instanceof Uint32Array))
    throw new TypeError('"s" expected Uint32Array(50), got type=' + typeof s);
  if (s.length !== 50)
    throw new RangeError('"s" expected Uint32Array(50), got length=' + s.length);
  anumber2(rounds, "rounds");
  if (rounds < 1 || rounds > 24)
    throw new Error('"rounds" expected integer 1..24');
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      const b0 = s[y], b1 = s[y + 1], b2 = s[y + 2], b3 = s[y + 3];
      s[y] ^= ~s[y + 2] & s[y + 4];
      s[y + 1] ^= ~s[y + 3] & s[y + 5];
      s[y + 2] ^= ~s[y + 4] & s[y + 6];
      s[y + 3] ^= ~s[y + 5] & s[y + 7];
      s[y + 4] ^= ~s[y + 6] & s[y + 8];
      s[y + 5] ^= ~s[y + 7] & s[y + 9];
      s[y + 6] ^= ~s[y + 8] & b0;
      s[y + 7] ^= ~s[y + 9] & b1;
      s[y + 8] ^= ~b0 & b2;
      s[y + 9] ^= ~b1 & b3;
    }
    s[0] ^= SHA3_IOTA_H[round];
    s[1] ^= SHA3_IOTA_L[round];
  }
  clean2(B);
}
var Keccak = class _Keccak {
  state;
  pos = 0;
  posOut = 0;
  finished = false;
  state32;
  destroyed = false;
  blockLen;
  suffix;
  outputLen;
  canXOF;
  enableXOF = false;
  rounds;
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    anumber2(blockLen, "blockLen");
    anumber2(suffix, "suffix");
    anumber2(rounds, "rounds");
    abool2(enableXOF, "enableXOF");
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.canXOF = enableXOF;
    this.rounds = rounds;
    anumber2(outputLen, "outputLen");
    if (!(0 < blockLen && blockLen < 200))
      throw new Error('"blockLen" must be 1..199');
    this.state = new Uint8Array(200);
    this.state32 = u322(this.state);
  }
  clone() {
    return this._cloneInto();
  }
  keccak() {
    swap32IfBE2(this.state32);
    keccakP(this.state32, this.rounds);
    swap32IfBE2(this.state32);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    aexists2(this);
    abytes2(data);
    const { blockLen, state, state32 } = this;
    const len = data.length;
    const canUseU32 = blockLen % 4 === 0 && data.byteOffset % 4 === 0;
    const blockLen32 = blockLen / 4;
    const data32 = canUseU32 && len >= blockLen ? u322(data) : void 0;
    for (let pos = 0; pos < len; ) {
      if (data32 !== void 0 && this.pos === 0 && pos % 4 === 0 && len - pos >= blockLen) {
        for (let i = 0, o = pos / 4; i < blockLen32; i++)
          state32[i] ^= data32[o + i];
        pos += blockLen;
        this.pos = blockLen;
        this.keccak();
        continue;
      }
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state, suffix, pos, blockLen } = this;
    state[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    aexists2(this, false);
    abytes2(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not enabled");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber2(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput2(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out.length === this.outputLen ? out : out.subarray(0, this.outputLen));
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.outputLen);
    this.digestInto(out);
    return out;
  }
  destroy() {
    this.destroyed = true;
    clean2(this.state);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to ||= new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds);
    to.blockLen = blockLen;
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.canXOF = this.canXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var genKeccak = (suffix, blockLen, outputLen, info = {}) => createHasher(() => new Keccak(blockLen, suffix, outputLen), info);
var keccak_256 = /* @__PURE__ */ genKeccak(1, 136, 32);

// vendor/taperelay-client/src/selfid.mjs
var SELF_RE = /^key:(0x[0-9a-f]{40})@([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[1-9][0-9]{0,4})?)$/;
function isSelfAccount(s) {
  const m = typeof s === "string" ? SELF_RE.exec(s) : null;
  if (!m) return false;
  if (s.length > 128) return false;
  const port = m[6] ? Number(m[6].slice(1)) : null;
  return port === null || port >= 1 && port <= 65535;
}

// vendor/taperelay-client/src/circuit.mjs
var SUPPORTED_CHAINS = Object.freeze([56, 196, 8453]);
var CHAIN_AREA = Object.freeze({ 56: null, 196: 2, 8453: 3 });
var AREA_CHAIN = Object.freeze({ 2: 196, 3: 8453 });
var MAX_ID = 10n ** 18n;
var MAX_PROCESSOR = 10n ** 9n;
var MAX_NAME = 64;
var NAME_RE = /^([1-9][0-9]*)\.(?:([1-9][0-9]*)\.)?(0|[1-9][0-9]*)\.tape$/;
function fromParts(id2, area, processor) {
  if (BigInt(id2) > MAX_ID || BigInt(processor) > MAX_PROCESSOR) return null;
  const chainId = area === void 0 || area === null ? 56 : AREA_CHAIN[area];
  if (!chainId || !SUPPORTED_CHAINS.includes(chainId)) return null;
  return { chainId, area: area === void 0 || area === null ? null : Number(area), processor: Number(processor), id: id2 };
}
function parseCircuit(name) {
  if (typeof name !== "string" || name.length > MAX_NAME) return null;
  const m = NAME_RE.exec(name);
  return m ? fromParts(m[1], m[2], m[3]) : null;
}
var isAccount = (s) => parseCircuit(s) !== null;
function normalizeCircuitInput(input) {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (s.length > 2048) return null;
  const url = /^(?:web\+)?tape:\/\/([^/?#]*)(?:[/?#].*)?$/.exec(s);
  if (url) s = url[1];
  const label = /^#?([1-9][0-9]*)@((?:[1-9][0-9]*\.)?(?:0|[1-9][0-9]*))$/.exec(s);
  if (label) s = `${label[1]}.${label[2]}`;
  if (!s.endsWith(".tape")) s = `${s}.tape`;
  return isAccount(s) ? s : null;
}

// vendor/taperelay-client/src/core.mjs
var HEX64 = /^[0-9a-f]{64}$/;
var enc = new TextEncoder();
var utf8 = (s) => enc.encode(s);
var hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function fromHex(h) {
  if (typeof h !== "string" || h.length % 2 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("\u4E0D\u662F\u5341\u516D\u8FDB\u5236");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
var sha256Hex = (bytes) => hex(sha256(bytes));
var randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
var domainFor = (account) => ({ name: constants_default.eip712DomainName, version: "1", chainId: isSelfAccount(account) ? 0 : parseCircuit(account)?.chainId ?? NaN });
var TYPE_DEFS = Object.freeze({
  EIP712Domain: "string name,string version,uint256 chainId",
  Request: "string account,string server,string method,string path,string query,bytes32 bodyHash,uint64 timestamp,bytes16 nonce",
  // 2026-11-07（D-620）：旧格式的 Delegation（没有 app、scopes）删了；授权声明只有 ScopedDelegation 和 DeveloperKey 两种
  ScopedDelegation: "string account,address sessionKey,string[] servers,uint64 notBefore,uint64 expires,string app,string[] scopes",
  // 2026-10-22（TapeRelay §8.3，D-339、D-349）
  // 2026-10-30（TapeRelay §8.7，D-526，审查 38 的 I-398）：长期的授权（开发者密钥）单独一种类型，钱包里一眼看得出；note 是持有人写的用途（钱包里显示）
  DeveloperKey: "string account,address sessionKey,string[] servers,uint64 notBefore,uint64 expires,string app,string[] scopes,string note",
  Revocation: "string account,address sessionKey,uint64 revokedAt",
  Notice: "string from,string to,bytes32 envelope,string body,string[] servers,uint64 createdAt",
  // 2026-11-07（D-649、D-654）：manifest（公开文件）去掉；body 是直接带的密文（sealedbody.mjs）
  // 2026-11-01（免费消息层）：自主身份之间的消息。和 Notice 是两种类型、各自算摘要，所以加这一项不动任何已有的签名。
  // 跟 Notice 的三处不同：① body 直接装内容（客户端自己加密，服务器不看），不指向存储对象，所以不要钱；
  // ② 没有 servers：收件人的节点就写在它的身份里（key:0x…@节点域名），不必读发现文件；③ 域的 chainId 为 0（domainFor），
  // 两层的签名因此不能互相顶用。
  SelfNotice: "string from,string to,string body,uint64 createdAt",
  // 2026-11-07（D-652、D-655，消息层设计稿第四节）：自主身份公开自己的加密公钥：身份的签名密钥签这一份，放在背书服务器上
  // （PUT /v1/keys/{身份}），谁都能取；服务器改不了内容，最多不给或给旧的。域的 chainId 为 0（domainFor），和 SelfNotice 一样
  SelfEncryptionKey: "string account,bytes32 key,uint64 createdAt",
  EncryptionKey: "string account,bytes32 key,address holder",
  Pointer: "string account,string name,uint64 version,bytes32 target,string kind,uint64 createdAt"
  // 第 312 条（TapeRelay §7.3，D-252、D-265）
});
var FIELDS = Object.fromEntries(Object.entries(TYPE_DEFS).map(([n, d]) => [n, d.split(",").map((f) => {
  const [type, name] = f.split(" ");
  return { type, name };
})]));
var BadMessage = class extends Error {
};
var isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
function uintWord(v, bits) {
  if (!Number.isSafeInteger(v) || v < 0 || BigInt(v) >= 1n << BigInt(bits)) throw new BadMessage();
  return fromHex(v.toString(16).padStart(64, "0"));
}
function word(type, v) {
  switch (type) {
    case "string":
      if (typeof v !== "string") throw new BadMessage();
      return keccak_256(utf8(v));
    case "string[]":
      if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) throw new BadMessage();
      return keccak_256(concat(...v.map((s) => keccak_256(utf8(s)))));
    case "address":
      if (typeof v !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(v)) throw new BadMessage();
      return concat(new Uint8Array(12), fromHex(v.slice(2)));
    case "bytes32":
      if (typeof v !== "string" || !/^0x[0-9a-f]{64}$/.test(v)) throw new BadMessage();
      return fromHex(v.slice(2));
    case "bytes16":
      if (typeof v !== "string" || !/^0x[0-9a-f]{32}$/.test(v)) throw new BadMessage();
      return concat(fromHex(v.slice(2)), new Uint8Array(16));
    case "uint64":
      return uintWord(v, 64);
    case "uint256":
      return uintWord(v, 256);
    default:
      throw new BadMessage();
  }
}
function hashStruct(name, msg) {
  const fields = FIELDS[name];
  if (!fields || !isObj(msg) || Object.keys(msg).length !== fields.length || !fields.every((f) => Object.hasOwn(msg, f.name))) throw new BadMessage();
  return keccak_256(concat(keccak_256(utf8(`${name}(${TYPE_DEFS[name]})`)), ...fields.map((f) => word(f.type, msg[f.name]))));
}
var SCOPES = Object.freeze(["objects", "send", "inbox", "pointers", "release", "admit"]);
var SESSION_SCOPES = Object.freeze(["objects", "send", "inbox", "pointers", "admit"]);
var DEV_KEY_ONLY_SCOPES = Object.freeze(["release"]);
var delegationType = (dm) => !isObj(dm) ? null : Object.hasOwn(dm, "note") ? "DeveloperKey" : Object.hasOwn(dm, "scopes") ? "ScopedDelegation" : null;
var DEV_KEY_MAX_SECONDS = 31622400;
function digest(primaryType, domain, message) {
  try {
    return keccak_256(concat(Uint8Array.of(25, 1), hashStruct("EIP712Domain", domain), hashStruct(primaryType, message)));
  } catch (e) {
    if (e instanceof BadMessage) return null;
    throw e;
  }
}
function typedData(primaryType, domain, message) {
  return { types: { EIP712Domain: FIELDS.EIP712Domain, [primaryType]: FIELDS[primaryType] }, primaryType, domain, message };
}
var N = secp256k1.Point.Fn.ORDER;
function normalizeSignature(sig) {
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return null;
  const b = fromHex(sig.slice(2));
  let v = b[64];
  if (v === 0 || v === 1) v += 27;
  if (v !== 27 && v !== 28) return null;
  let s = BigInt(`0x${hex(b.subarray(32, 64))}`);
  if (s === 0n || s >= N) return null;
  if (s > N / 2n) {
    s = N - s;
    v = v === 27 ? 28 : 27;
  }
  return `0x${hex(b.subarray(0, 32))}${s.toString(16).padStart(64, "0")}${v.toString(16)}`;
}

// vendor/taperelay-client/src/manifest.mjs
var CHUNK = 1048576;
var ENCRYPTED_CHUNK = 1048536;
var FANOUT = 32766;
var MAX_MANIFEST = 16384;
var HEX642 = /^[0-9a-f]{64}$/;
var enc2 = new TextEncoder();
function contentTypeOf(ct) {
  const s = String(ct || "").replace(/[^\w.+/;=\- ]/g, "").slice(0, 100);
  return /^[\w.+-]+\/[\w.+-]+/.test(s) ? s : "application/octet-stream";
}
function layoutOf(size, chunkSize = CHUNK) {
  if (!Number.isSafeInteger(size) || size < 1) return null;
  const n = Math.ceil(size / chunkSize);
  if (n <= FANOUT) return { n, levels: 1, lower: 0 };
  if (n <= FANOUT * FANOUT) return { n, levels: 2, lower: Math.ceil(n / FANOUT) };
  return null;
}
function checkManifest(text) {
  if (typeof text !== "string" || enc2.encode(text).length > MAX_MANIFEST) return { error: "\u6E05\u5355\u8D85\u8FC7 16 KiB" };
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return { error: "\u6E05\u5355\u4E0D\u662F\u5408\u6CD5\u7684 JSON" };
  }
  const chunkSize = m?.type === "public" ? CHUNK : m?.type === "encrypted" ? ENCRYPTED_CHUNK : null;
  const ok = m && typeof m === "object" && m.version === 1 && chunkSize !== null && m.chunkSize === chunkSize && Number.isSafeInteger(m.size) && m.size >= 1 && typeof m.name === "string" && typeof m.contentType === "string" && typeof m.index === "string" && HEX642.test(m.index) && (m.sha256 === void 0 || typeof m.sha256 === "string" && HEX642.test(m.sha256));
  if (!ok) return { error: "\u6E05\u5355\u4E0D\u5408\u683C\uFF08Files \xA73\uFF09" };
  if (m.type === "encrypted" && !isAccount(m.from)) return { error: "\u52A0\u5BC6\u7684\u6E05\u5355\u7F3A from\uFF0C\u6216 from \u4E0D\u662F\u7535\u8DEF\u7684\u89C4\u8303\u540D\u5B57\uFF08Files \xA75.5\uFF09" };
  if (!layoutOf(m.size, chunkSize)) return { error: "v0.1 \u4E0D\u652F\u6301\u8FD9\u4E48\u5927\u7684\u6587\u4EF6\uFF08Files \xA73\uFF09" };
  const manifest = { version: 1, type: m.type, name: m.name, contentType: contentTypeOf(m.contentType), size: m.size, chunkSize, index: m.index };
  if (m.sha256 !== void 0) manifest.sha256 = m.sha256;
  if (m.type === "encrypted") manifest.from = m.from;
  return { manifest };
}

// vendor/taperelay-client/src/files.mjs
function layout(size, chunkSize = CHUNK) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("\u6587\u4EF6\u5927\u5C0F\u81F3\u5C11 1 \u5B57\u8282");
  const l = layoutOf(size, chunkSize);
  if (!l) throw new Error("v0.1 \u4E0D\u652F\u6301\u8FD9\u4E48\u5927\u7684\u6587\u4EF6\uFF08Files \xA73\uFF09");
  return l;
}
function sourceOf(x) {
  if (x instanceof Uint8Array) return { size: x.length, read: async (a, b) => x.subarray(a, b) };
  if (x && typeof x.size === "number" && typeof x.slice === "function") return { size: x.size, read: async (a, b) => new Uint8Array(await x.slice(a, b).arrayBuffer()) };
  throw new Error("\u6587\u4EF6\u8981\u662F Uint8Array \u6216 Blob");
}
async function planPublicFile(input, { name = "", contentType = "application/octet-stream", wholeSha256 = false, withManifest = false } = {}) {
  const source = sourceOf(input);
  const { n, levels, lower } = layout(source.size);
  const chunkHashes = [];
  const whole = wholeSha256 ? sha256.create() : null;
  for (let i = 0; i < n; i++) {
    const bytes = await source.read(i * CHUNK, Math.min(source.size, (i + 1) * CHUNK));
    chunkHashes.push(sha256Hex(bytes));
    whole?.update(bytes);
  }
  const indexObjects = indexObjectsOf(chunkHashes, { levels, lower });
  const fileId = indexObjects[0].sha256;
  const manifest = { version: 1, type: "public", name: String(name), contentType: contentTypeOf(contentType), size: source.size, chunkSize: CHUNK, index: fileId };
  if (whole) manifest.sha256 = hex(whole.digest());
  const manifestJson = JSON.stringify(manifest);
  const manifestBytes = utf8(manifestJson);
  if (manifestBytes.length > MAX_MANIFEST) throw new Error("\u6E05\u5355\u8D85\u8FC7 16 KiB\uFF08\u6587\u4EF6\u540D\u592A\u957F\uFF1F\uFF09");
  if (!withManifest) return { source, chunkHashes, indexObjects, manifest, manifestJson, fileId };
  const manifestObject = { bytes: manifestBytes, sha256: sha256Hex(manifestBytes) };
  return { source, chunkHashes, indexObjects, manifest, manifestJson, fileId, manifestObject, extraObjects: [manifestObject] };
}
function indexObjectsOf(chunkHashes, { levels, lower } = layout(chunkHashes.length, 1)) {
  if (levels === 1) {
    const bytes = concat(...chunkHashes.map(fromHex));
    return [{ bytes, sha256: sha256Hex(bytes), level: 0, position: 0 }];
  }
  const lowers = [];
  for (let j = 0; j < lower; j++) {
    const bytes = concat(...chunkHashes.slice(j * FANOUT, (j + 1) * FANOUT).map(fromHex));
    lowers.push({ bytes, sha256: sha256Hex(bytes), level: 1, position: j });
  }
  const top = concat(...lowers.map((l) => fromHex(l.sha256)));
  return [{ bytes: top, sha256: sha256Hex(top), level: 0, position: 0 }, ...lowers];
}

// vendor/taperelay-client/src/session.mjs
var H = (name) => constants_default.headerPrefix + name;
function serverUrl(name) {
  const m = /^([a-z0-9.-]+):([1-9][0-9]{0,4})$/.exec(name);
  if (!m) throw new Error(`\u670D\u52A1\u5668\u540D\u5B57\u7684\u5199\u6CD5\u4E0D\u5BF9\uFF1A${name}`);
  return m[2] === "443" ? `https://${m[1]}` : `https://${m[1]}:${m[2]}`;
}
async function signedHeaders(auth, { server, method, path, query = "", body, now, nonce = randomHex(16), upload = false }) {
  const bodyHash = sha256Hex(body ?? new Uint8Array(0));
  const message = { account: auth.account, server, method, path, query, bodyHash: `0x${bodyHash}`, timestamp: now, nonce: `0x${nonce}` };
  const domain = domainFor(auth.account);
  const signature = await auth.sign(digest("Request", domain, message), typedData("Request", domain, message), body);
  const headers = { [H("Account")]: auth.account, [H("Timestamp")]: String(now), [H("Nonce")]: nonce, [H("Signature")]: signature };
  if (auth.delegationHeader) headers[H("Delegation")] = auth.delegationHeader;
  if (upload) headers[H("Object")] = bodyHash;
  return headers;
}

// vendor/taperelay-client/src/client.mjs
var TapeRelayError = class extends Error {
  constructor(code, { status, tapekitStatus, server } = {}) {
    super(`${code}${server ? `\uFF08${server}\uFF09` : ""}`);
    this.code = code;
    this.status = status;
    this.tapekitStatus = tapekitStatus;
    this.server = server;
  }
};
var MAX_REPLY = 1048576;
async function readAtMost(res, max) {
  if (Number(res.headers.get("content-length")) > max) {
    await res.body?.cancel().catch(() => {
    });
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {
      });
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
var REQUEST_TIMEOUT_MS = 6e4;
var MIRROR_TIMEOUT_MS = 2e4;
var HEDGE_MS = 2e3;
var okMirrorUrl = (u) => {
  try {
    const x = new URL(u);
    return typeof u === "string" && u.length <= 200 && x.protocol === "https:" && !x.username && !x.password && !x.search && !x.hash && !u.endsWith("/");
  } catch {
    return false;
  }
};
function createClient({ fetch = globalThis.fetch, now = () => Math.floor(Date.now() / 1e3), timeoutMs = REQUEST_TIMEOUT_MS, mirrors } = {}) {
  const mirrorState = /* @__PURE__ */ new Map();
  let mirrorBusy = 0;
  function mirrorsOf(name) {
    if (!mirrorState.has(name)) {
      const st = { list: [], off: true };
      mirrorState.set(name, st);
      if (mirrors && typeof mirrors === "object" && Array.isArray(mirrors[name])) {
        st.list = mirrors[name].filter(okMirrorUrl).slice(0, 4);
        st.off = !st.list.length;
      } else if (mirrors === "auto") {
        send(name, { path: "/v1/info", timeout: 8e3 }).then((r) => {
          const list = r.status === 200 && Array.isArray(r.json?.mirrors) ? r.json.mirrors.filter(okMirrorUrl).slice(0, 4) : [];
          if (list.length) {
            st.list = list;
            st.off = false;
          }
        }, () => {
        });
      }
    }
    return mirrorState.get(name);
  }
  function fromMirror(base, sha) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("timeout")), MIRROR_TIMEOUT_MS);
    const res = fetch(`${base}/v1/objects/${sha}`, { method: "GET", redirect: "manual", signal: ac.signal });
    const headers = res.then((r) => r.status === 200, () => false);
    mirrorBusy++;
    const body = (async () => {
      try {
        const r = await res;
        if (r.status !== 200) throw new TapeRelayError(`http-${r.status}`, { status: r.status, server: base });
        const bytes = await readAtMost(r, MAX_REPLY);
        if (!bytes || sha256Hex(bytes) !== sha) throw new TapeRelayError("hash-mismatch", { server: base });
        return bytes;
      } finally {
        clearTimeout(timer);
        mirrorBusy--;
      }
    })();
    body.catch(() => {
    });
    return { headers, body };
  }
  async function send(name, { method = "GET", path, query = "", body, auth, upload = false, tooLarge = "unreachable", maxReply = MAX_REPLY, timeout = timeoutMs }) {
    const headers = {};
    if (body) headers["Content-Type"] = upload ? "application/octet-stream" : "application/json";
    if (auth) Object.assign(headers, await signedHeaders(auth, { server: name, method, path, query, body, now: now(), upload }));
    let res, bytes;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("timeout")), timeout);
    try {
      res = await fetch(`${serverUrl(name)}${path}${query ? `?${query}` : ""}`, { method, headers, body, redirect: "manual", cache: "no-store", signal: ac.signal });
      bytes = await readAtMost(res, maxReply);
    } catch {
      throw new TapeRelayError("unreachable", { server: name });
    } finally {
      clearTimeout(timer);
    }
    if (!bytes) throw new TapeRelayError(tooLarge, { status: res.status, server: name });
    let json;
    if (/json/i.test(res.headers.get("content-type") ?? "")) {
      try {
        json = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        json = void 0;
      }
    }
    return { status: res.status, headers: res.headers, bytes, json };
  }
  const expect = (r, name, ...statuses) => {
    if (statuses.includes(r.status)) return r;
    const code = typeof r.json?.error === "string" ? r.json.error : `http-${r.status}`;
    throw new TapeRelayError(code, { status: r.status, tapekitStatus: r.json?.tapekitStatus, server: name });
  };
  const jsonBody = (v) => utf8(JSON.stringify(v));
  return {
    now,
    /** TapeRelay §10.1 */
    info: async (name) => expect(await send(name, { path: "/v1/info" }), name, 200).json,
    /** TapeRelay §6.1：上传一个对象；返回 { created（新存的为 true）, sha256 } */
    async upload(name, auth, bytes) {
      const r = expect(await send(name, { method: "POST", path: "/v1/objects", body: bytes, auth, upload: true }), name, 200, 201);
      return { created: r.status === 201, sha256: sha256Hex(bytes) };
    },
    /** TapeRelay §6.3：最多 1,000 个；返回 { claimed, missing } */
    claim: async (name, auth, objects) => expect(await send(name, { method: "POST", path: "/v1/objects/claim", body: jsonBody({ objects }), auth }), name, 200).json,
    /**
     * 2026-10-29（D-518）：给建在本协议上的标准（例如 TapeStore 的 storage.mjs）发一个请求：给了 auth 就签名；回复的状态码不在 ok 里就抛
     * TapeRelayError（与上面各个接口相同）。返回 { status, headers, bytes, json }。ok 默认 [200]
     */
    async request(name, { method = "GET", path, query = "", body, auth, maxReply = MAX_REPLY } = {}, ok = [200]) {
      if (typeof path !== "string" || !path.startsWith("/v1/")) throw new Error("path \u8981\u4EE5 /v1/ \u5F00\u5934");
      return expect(await send(name, { method, path, query, body, auth, maxReply }), name, ...ok);
    },
    /** TapeRelay §8.4：撤销的请求体（session.mjs 的 signRevocation），不签请求头 */
    async revoke(name, revocationJson) {
      expect(await send(name, { method: "POST", path: "/v1/revocations", body: utf8(revocationJson) }), name, 204);
    },
    // ---- 第 286 条（收件箱改造，TapeRelay §9.3、TapeRelay §9.6）：inbox.mjs 用 ----
    /** TapeRelay §9.3：把签名的通知（字节）交给这台服务器；返回 { id } */
    submitNotice: async (name, auth, body) => expect(await send(name, { method: "POST", path: "/v1/outbox", body, auth }), name, 202).json,
    /** TapeRelay §9.3：投递状态（不签名）；返回 { id, status, error? }，不是这台收下的抛 not-found */
    async outboxStatus(name, id2) {
      if (!HEX64.test(id2)) throw new Error("\u901A\u77E5\u7F16\u53F7\u8981\u662F 64 \u4F4D\u5C0F\u5199\u5341\u516D\u8FDB\u5236");
      return expect(await send(name, { path: `/v1/outbox/${id2}` }), name, 200).json;
    },
    /** TapeRelay §9.6：拉取自己收件箱的一页；一条通知最多 16 KiB（服务器的上限），一页 100 条也不超过 2 MiB */
    async inbox(name, auth, { cursor, limit } = {}) {
      const q = new URLSearchParams();
      if (limit) q.set("limit", String(limit));
      if (cursor) q.set("cursor", cursor);
      return expect(await send(name, { path: `/v1/inbox/${auth.account}`, query: q.toString(), auth, maxReply: 2 * MAX_REPLY }), name, 200).json;
    },
    /** D-659：「已发送」的一页（GET /v1/outbox，自己签名；新的在前）；一页最多 100 条，每条带投递状态 */
    async sent(name, auth, { cursor, limit } = {}) {
      const q = new URLSearchParams();
      if (limit) q.set("limit", String(limit));
      if (cursor) q.set("cursor", cursor);
      return expect(await send(name, { path: "/v1/outbox", query: q.toString(), auth, maxReply: 2 * MAX_REPLY }), name, 200).json;
    },
    /** TapeRelay §9.6：标记已读，最多 100 个 */
    async markRead(name, auth, ids) {
      expect(await send(name, { method: "POST", path: `/v1/inbox/${auth.account}/read`, body: jsonBody({ ids }), auth }), name, 204);
    },
    // ---- 2026-10-28（TapeRelay §9.10，D-503）：服务器消息，servermsgs.mjs 用 ----
    /** TapeRelay §9.10：拉取自己的服务器消息的一页；一条最多约 26 KiB（标题 100、正文 2,000 个字符全写成 \uXXXX），一页 100 条不超过 4 MiB */
    async serverMessages(name, auth, { cursor, limit } = {}) {
      const q = new URLSearchParams();
      if (limit) q.set("limit", String(limit));
      if (cursor) q.set("cursor", cursor);
      return expect(await send(name, { path: `/v1/server-messages/${auth.account}`, query: q.toString(), auth, maxReply: 4 * MAX_REPLY }), name, 200).json;
    },
    /** TapeRelay §9.10：服务器消息标记已读，最多 100 个 */
    async markServerMessagesRead(name, auth, ids) {
      expect(await send(name, { method: "POST", path: `/v1/server-messages/${auth.account}/read`, body: jsonBody({ ids }), auth }), name, 204);
    },
    // ---- 第 312 条（签名指针，TapeRelay §7.3）：pointers.mjs 用；account、pname 由它先核对过写法 ----
    /** TapeRelay §7.3：把签名的指针（字节）写给这台服务器（204）；版号不比存着的大抛 pointer-not-newer */
    async putPointer(name, auth, account, pname, body) {
      expect(await send(name, { method: "PUT", path: `/v1/pointers/${account}/${pname}`, body, auth }), name, 204);
    },
    /** TapeRelay §7.3：读一个名字存着的签名的指针（不签名）；服务器只收 16 KiB 以内的，更大的回复当作不对（bad-reply）；没有这个名字抛 not-found */
    async getPointer(name, account, pname) {
      const r = expect(await send(name, { path: `/v1/pointers/${account}/${pname}`, maxReply: 16384, tooLarge: "bad-reply" }), name, 200);
      if (r.json === void 0) throw new TapeRelayError("bad-reply", { server: name });
      return r.json;
    },
    /**
     * TapeRelay §6.2：读一个对象的全部字节，核对 SHA-256；不符抛 hash-mismatch。maxBytes：比 1 MiB 更小的上限（例如清单对象 16 KiB，TapeRelay §9.8），
     * 超过就停下、不读完，抛 too-large（第 154 条）
     */
    async getObject(name, sha, { maxBytes } = {}) {
      if (!HEX64.test(sha)) throw new Error("\u5BF9\u8C61\u5730\u5740\u8981\u662F 64 \u4F4D\u5C0F\u5199\u5341\u516D\u8FDB\u5236");
      const direct = async () => {
        const r = expect(await send(name, { path: `/v1/objects/${sha}`, tooLarge: maxBytes ? "too-large" : "hash-mismatch", maxReply: maxBytes ? Math.min(maxBytes, MAX_REPLY) : MAX_REPLY }), name, 200);
        if (sha256Hex(r.bytes) !== sha) throw new TapeRelayError("hash-mismatch", { server: name });
        return r.bytes;
      };
      const m = !maxBytes && mirrors ? mirrorsOf(name) : null;
      if (!m || m.off || !m.list.length) return direct();
      const alone = mirrorBusy === 0;
      const mm = fromMirror(m.list[0], sha);
      const noteFail = (e) => {
        if (e?.status !== 404 && e?.status !== 451) m.off = true;
      };
      mm.body.catch(noteFail);
      const started = alone ? await Promise.race([mm.headers, new Promise((r) => setTimeout(() => r(null), HEDGE_MS))]) : await mm.headers;
      if (started === true) {
        try {
          return await mm.body;
        } catch {
          return direct();
        }
      }
      if (started === false) return direct();
      const viaServer = direct();
      viaServer.catch(() => {
      });
      try {
        return await Promise.any([mm.body, viaServer]);
      } catch {
        return viaServer;
      }
    },
    /**
     * TapeRelay §6.2 的 HEAD：这台服务器上有没有这个对象（不要签名，不读内容）。200 → true；404（not-found）、451（taken-down）→ false；
     * 别的回复照常抛错（第 262 条，阶段 6）。只说明那台上有这份内容，不说明记在谁名下：给没登录的场合用（例如打开别人发来的链接时
     * 看哪台有）；核对自己的副本用列出（replicas.mjs 的 checkReplicas，D-223；第 276 条起，原来用认领，D-214）
     */
    async has(name, sha) {
      if (!HEX64.test(sha)) throw new Error("\u5BF9\u8C61\u5730\u5740\u8981\u662F 64 \u4F4D\u5C0F\u5199\u5341\u516D\u8FDB\u5236");
      const r = await send(name, { method: "HEAD", path: `/v1/objects/${sha}` });
      if (r.status === 200) return true;
      if (r.status === 404 || r.status === 451) return false;
      throw new TapeRelayError(`http-${r.status}`, { status: r.status, server: name });
    }
  };
}

// vendor/taperelay-client/src/read.mjs
async function readObject(client, servers, sha, opts) {
  let last = null;
  for (const name of servers) {
    try {
      return await client.getObject(name, sha, opts);
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new TapeRelayError("not-found");
}

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/abstract/edwards.js
var _0n7 = /* @__PURE__ */ BigInt(0);
var _1n6 = /* @__PURE__ */ BigInt(1);
var _2n5 = /* @__PURE__ */ BigInt(2);
var _4n4 = /* @__PURE__ */ BigInt(4);
var _8n2 = /* @__PURE__ */ BigInt(8);
function isEdValidXY(Fp, CURVE, x, y) {
  const x2 = Fp.sqr(x);
  const y2 = Fp.sqr(y);
  const left = Fp.add(Fp.mul(CURVE.a, x2), y2);
  const right = Fp.add(Fp.ONE, Fp.mul(CURVE.d, Fp.mul(x2, y2)));
  return Fp.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  validateObject(extraOpts, {}, {}, "extraOpts");
  const opts = extraOpts;
  const validated = createCurveFields("edwards", params, opts, opts.FpFnLE);
  const { Fp, Fn } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  if (FpLegendre(Fp, CURVE.a) !== 1)
    throw new Error("edwards: CURVE.a must be a square in Fp for complete addition formulas");
  if (FpLegendre(Fp, CURVE.d) !== -1)
    throw new Error("edwards: CURVE.d must be a non-square in Fp for complete addition formulas");
  validateObject(opts, {}, { uvRatio: "function", randomBytes: "function" });
  const randomBytes4 = opts.randomBytes === void 0 ? randomBytes3 : opts.randomBytes;
  const MASK = _2n5 << BigInt(Fp.BYTES * 8) - _1n6;
  function isOdd(n) {
    if (!Fp.isOdd)
      throw new Error("Field does not have .isOdd()");
    return Fp.isOdd(n);
  }
  const uvRatio2 = opts.uvRatio === void 0 ? (u, v) => {
    try {
      return { isValid: true, value: Fp.sqrt(Fp.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n7 };
    }
  } : opts.uvRatio;
  if (!isEdValidXY(Fp, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const mulA = Fp.eql(CURVE.a, Fp.neg(Fp.ONE)) ? (x) => Fp.neg(x) : Fp.eql(CURVE.a, Fp.ONE) ? (x) => x : (x) => Fp.mul(CURVE.a, x);
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n6 : _0n7;
    aInRange("coordinate " + title, n, min, MASK);
    return n;
  }
  function aedpoint(other) {
    if (!(other instanceof Point))
      throw new Error("EdwardsPoint expected");
  }
  class Point {
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE, Fp.mul(CURVE.Gx, CURVE.Gy));
    static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ONE, Fp.ZERO);
    static Fp = Fp;
    static Fn = Fn;
    X;
    Y;
    Z;
    T;
    constructor(X, Y, Z, T) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /**
     * Create one extended Edwards point from affine coordinates.
     * Does NOT validate that the point is on-curve or torsion-free.
     * Use `.assertValidity()` on adversarial inputs.
     */
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new Point(x, y, Fp.ONE, Fp.mul(x, y));
    }
    // Uses algo from RFC8032 5.1.3.
    static fromBytes(bytes, zip215 = false) {
      const len = Fp.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes3(abytes3(bytes, len, "point"));
      abool3(zip215, "zip215");
      const normed = copyBytes3(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE(normed);
      const max = zip215 ? MASK : Fp.ORDER;
      aInRange("point.y", y, _0n7, max);
      const y2 = Fp.sqr(y);
      const u = Fp.sub(y2, Fp.ONE);
      const v = Fp.sub(Fp.mulN(d, y2), a);
      let { isValid, value: x } = uvRatio2(u, v);
      if (!isValid)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = isOdd(x);
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && Fp.is0(x) && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = Fp.neg(x);
      return Point.fromAffine({ x, y });
    }
    static fromHex(hex3, zip215 = false) {
      return Point.fromBytes(hexToBytes2(hex3), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 6, isLazy = true) {
      wnaf.setWindowSize(this, windowSize);
      if (!isLazy)
        this.multiply(_2n5);
      return this;
    }
    // Useful in fromAffine() - not for fromBytes(), which always created valid points.
    assertValidity() {
      const p = this;
      const { a, d } = CURVE;
      if (p.is0())
        throw new Error("bad point: ZERO");
      const { X, Y, Z, T } = p;
      const X2 = Fp.sqr(X);
      const Y2 = Fp.sqr(Y);
      const Z2 = Fp.sqr(Z);
      const Z4 = Fp.sqr(Z2);
      const aX2 = Fp.mul(X2, a);
      const left = Fp.mul(Fp.add(aX2, Y2), Z2);
      const right = Fp.add(Z4, Fp.mul(d, Fp.mul(X2, Y2)));
      if (!Fp.eql(left, right))
        throw new Error("bad point: equation left != right (1)");
      const XY = Fp.mul(X, Y);
      const ZT = Fp.mul(Z, T);
      if (!Fp.eql(XY, ZT))
        throw new Error("bad point: equation left != right (2)");
    }
    // Compare one point to another.
    equals(other) {
      aedpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = Fp.mul(X1, Z2);
      const X2Z1 = Fp.mul(X2, Z1);
      const Y1Z2 = Fp.mul(Y1, Z2);
      const Y2Z1 = Fp.mul(Y2, Z1);
      return Fp.eql(X1Z2, X2Z1) && Fp.eql(Y1Z2, Y2Z1);
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    negate() {
      return new Point(Fp.neg(this.X), this.Y, this.Z, Fp.neg(this.T));
    }
    // Fast algo for doubling Extended Point.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
    // Cost: 4M + 4S + 1*a + 6add + 1*2.
    double() {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = Fp.sqr(X1);
      const B2 = Fp.sqr(Y1);
      const C = Fp.mul(Fp.sqr(Z1), _2n5);
      const D = mulA(A);
      const x1y1 = Fp.addN(X1, Y1);
      const E = Fp.sub(Fp.subN(Fp.sqr(x1y1), A), B2);
      const G = Fp.addN(D, B2);
      const F = Fp.subN(G, C);
      const H2 = Fp.subN(D, B2);
      const X3 = Fp.mul(E, F);
      const Y3 = Fp.mul(G, H2);
      const T3 = Fp.mul(E, H2);
      const Z3 = Fp.mul(F, G);
      return new Point(X3, Y3, Z3, T3);
    }
    // Fast algo for adding 2 Extended Points.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
    // Cost: 9M + 1*a + 1*d + 7add.
    add(other) {
      aedpoint(other);
      const { d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
      const A = Fp.mul(X1, X2);
      const B2 = Fp.mul(Y1, Y2);
      const C = Fp.mul(Fp.mulN(T1, d), T2);
      const D = Fp.mul(Z1, Z2);
      const E = Fp.sub(Fp.subN(Fp.mulN(Fp.addN(X1, Y1), Fp.addN(X2, Y2)), A), B2);
      const F = Fp.subN(D, C);
      const G = Fp.addN(D, C);
      const H2 = Fp.sub(B2, mulA(A));
      const X3 = Fp.mul(E, F);
      const Y3 = Fp.mul(G, H2);
      const T3 = Fp.mul(E, H2);
      const Z3 = Fp.mul(F, G);
      return new Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      aedpoint(other);
      return this.add(other.negate());
    }
    // Constant-time multiplication.
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new RangeError("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Keeps the same subgroup-scalar contract: 0 is allowed for public-scalar callers, but
    // n and larger values are rejected instead of being reduced mod n to the identity point.
    multiplyUnsafe(scalar) {
      if (!Fn.isValid(scalar))
        throw new RangeError("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n7)
        return Point.ZERO;
      if (this.is0() || scalar === _1n6)
        return this;
      return wnaf.mulUnsafe(this, scalar, normalize);
    }
    // Checks if point is of small order.
    // If you add something to small order point, you will have "dirty"
    // point with torsion component.
    // Clears cofactor and checks if the result is 0.
    isSmallOrder() {
      return this.clearCofactor().is0();
    }
    // Multiplies point by curve order and checks if the result is 0.
    // Returns `false` is the point is dirty.
    isTorsionFree() {
      return wnaf.mulUnsafe(this, CURVE.n).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      if (iz != null && typeof iz !== "bigint")
        throw new TypeError('"invertedZ" expected bigint, got type=' + typeof iz);
      const { X, Y, Z } = p;
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.create(_8n2) : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ONE };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    clearCofactor() {
      if (cofactor === _1n6)
        return this;
      if (cofactor === _2n5)
        return this.double();
      if (cofactor === _4n4)
        return this.double().double();
      if (cofactor === _8n2)
        return this.double().double().double();
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp.toBytes(y);
      bytes[bytes.length - 1] |= isOdd(x) ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex2(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const normalize = (points) => normalizeZ(Point, points);
  const wnaf = new ScalarMultiplier(Point, randomBytes4);
  if (wnaf.bits >= 6)
    Point.BASE.precompute(6);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/abstract/montgomery.js
var _0n8 = /* @__PURE__ */ BigInt(0);
var _1n7 = /* @__PURE__ */ BigInt(1);
var _2n6 = /* @__PURE__ */ BigInt(2);
function cmask(P2, swap) {
  return P2 + swap - (swap >> _1n7 << _1n7);
}
function cswap(P2) {
  const offset = BigInt(6) * P2;
  return (mask, x_2, x_3) => {
    const sum = x_2 + x_3;
    const d = offset + x_3 - x_2;
    const a = (d * mask + x_2) % P2;
    return { x_2: a, x_3: sum - a };
  };
}
function validateOpts(curve) {
  validateObject(curve, {
    P: "bigint",
    type: "string",
    adjustScalarBytes: "function",
    powPminus2: "function"
  }, {
    randomBytes: "function",
    scalarMultBase: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { P: P2, type, adjustScalarBytes: adjustScalarBytes2, powPminus2, randomBytes: rand2 } = CURVE;
  const mulBaseHook = CURVE.scalarMultBase;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand2 === void 0 ? randomBytes3 : rand2;
  const montgomeryBits = is25519 ? 255 : 448;
  const swap = cswap(P2);
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n6 ** BigInt(254) : _2n6 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * (_2n6 ** BigInt(251) - _1n7) : BigInt(4) * (_2n6 ** BigInt(445) - _1n7);
  const maxScalar = minScalar + maxAdded + _1n7;
  const modP = (n) => mod(n, P2);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = copyBytes3(abytes3(u, fieldLen, "uCoordinate"));
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE(adjustScalarBytes2(copyBytes3(abytes3(scalar, fieldLen, "scalar"))));
  }
  const lowOrderU = new Set(is25519 ? [
    _0n8,
    _1n7,
    P2 - _1n7,
    BigInt("325606250916557431795983626356110631294008115727848805560023387167927233504"),
    BigInt("39382357235489614581723060781553021112529911719440698176882885853963445705823")
  ] : [_0n8, _1n7, P2 - _1n7]);
  function scalarMult(scalar, u) {
    const pointU = decodeU(u);
    if (lowOrderU.has(pointU))
      throw new Error("invalid private or public key received");
    const pu = montgomeryLadder(pointU, decodeScalar(scalar));
    if (pu === _0n8)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    if (mulBaseHook === void 0)
      return scalarMult(scalar, GuBytes);
    const k = decodeScalar(scalar);
    aInRange("scalar", k, minScalar, maxScalar);
    const pu = modP(mulBaseHook(k));
    if (pu === _0n8)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  const getPublicKey = scalarMultBase;
  const getSharedSecret = scalarMult;
  function montgomeryLadder(u, scalar) {
    aInRange("u", u, _0n8, P2);
    aInRange("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n7;
    let z_2 = _0n8;
    let x_3 = u;
    let z_3 = _1n7;
    const kx = k ^ k >> _1n7;
    for (let t = BigInt(montgomeryBits - 1); t >= _0n8; t--) {
      const mask2 = cmask(P2, kx >> t);
      ({ x_2, x_3 } = swap(mask2, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = swap(mask2, z_2, z_3));
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B2 = x_2 - z_2;
      const BB = modP(B2 * B2);
      const E = AA - BB;
      const C = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C * B2);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + modP(a24 * E)));
    }
    const mask = cmask(P2, k);
    ({ x_2, x_3 } = swap(mask, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  const lengths = {
    secretKey: fieldLen,
    publicKey: fieldLen,
    seed: fieldLen
  };
  const randomSecretKey = (seed) => {
    seed = seed === void 0 ? randomBytes_(fieldLen) : seed;
    abytes3(seed, lengths.seed, "seed");
    return seed;
  };
  const utils = { randomSecretKey };
  Object.freeze(lengths);
  Object.freeze(utils);
  return Object.freeze({
    keygen: createKeygen(randomSecretKey, getPublicKey),
    getSharedSecret,
    getPublicKey,
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  });
}

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+curves@2.4.0/node_modules/@noble/curves/ed25519.js
var _0n9 = /* @__PURE__ */ BigInt(0);
var _1n8 = /* @__PURE__ */ BigInt(1);
var _2n7 = /* @__PURE__ */ BigInt(2);
var _3n3 = /* @__PURE__ */ BigInt(3);
var _5n2 = /* @__PURE__ */ BigInt(5);
var _8n3 = /* @__PURE__ */ BigInt(8);
var ed25519_CURVE_p = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n3,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_3(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P2 = ed25519_CURVE_p;
  const x2 = x * x % P2;
  const b2 = x2 * x % P2;
  const b4 = pow2(b2, _2n7, P2) * b2 % P2;
  const b5 = pow2(b4, _1n8, P2) * x % P2;
  const b10 = pow2(b5, _5n2, P2) * b5 % P2;
  const b20 = pow2(b10, _10n, P2) * b10 % P2;
  const b40 = pow2(b20, _20n, P2) * b20 % P2;
  const b80 = pow2(b40, _40n, P2) * b40 % P2;
  const b160 = pow2(b80, _80n, P2) * b80 % P2;
  const b240 = pow2(b160, _80n, P2) * b80 % P2;
  const b250 = pow2(b240, _10n, P2) * b10 % P2;
  const pow_p_5_8 = pow2(b250, _2n7, P2) * x % P2;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio(u, v) {
  const P2 = ed25519_CURVE_p;
  const v3 = mod(v * v * v, P2);
  const v7 = mod(v3 * v3 * v, P2);
  const pow3 = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod(u * v3 * pow3, P2);
  const vx2 = mod(v * x * x, P2);
  const root1 = x;
  const root2 = mod(x * ED25519_SQRT_M1, P2);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u, P2);
  const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P2);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P2))
    x = mod(-x, P2);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var ed25519_Point = /* @__PURE__ */ edwards(ed25519_CURVE, { uvRatio });
var x25519 = /* @__PURE__ */ (() => {
  const P2 = ed25519_CURVE_p;
  const powPminus2 = (x) => {
    const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
    return mod(pow2(pow_p_5_8, _3n3, P2) * b2, P2);
  };
  return montgomery({
    P: P2,
    type: "x25519",
    powPminus2,
    adjustScalarBytes,
    // ~3x faster fixed-base: [k]B on the birationally-equivalent Edwards curve using cached
    // base tables, mapped back via u = (1+y)/(1-y) = (Z+Y)/(Z-Y) with one Fermat inversion.
    // Same construction as libsodium's crypto_scalarmult_curve25519_base.
    scalarMultBase: (k) => {
      const kn = mod(k, ed25519_Point.Fn.ORDER);
      if (kn === _0n9)
        return _0n9;
      const p = ed25519_Point.BASE.multiply(kn);
      return mod((p.Z + p.Y) * powPminus2(mod(p.Z - p.Y, P2)), P2);
    }
  });
})();

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+ciphers@2.4.0/node_modules/@noble/ciphers/salsa.js
function salsaCore(s, k, n, out, cnt, rounds = 20, cntHi = 0) {
  let y00 = s[0], y01 = k[0], y02 = k[1], y03 = k[2], y04 = k[3], y05 = s[1], y06 = n[0], y07 = n[1], y08 = cnt, y09 = cntHi, y10 = s[2], y11 = k[4], y12 = k[5], y13 = k[6], y14 = k[7], y15 = s[3];
  let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
  for (let r = 0; r < rounds; r += 2) {
    x04 ^= rotl(x00 + x12 | 0, 7);
    x08 ^= rotl(x04 + x00 | 0, 9);
    x12 ^= rotl(x08 + x04 | 0, 13);
    x00 ^= rotl(x12 + x08 | 0, 18);
    x09 ^= rotl(x05 + x01 | 0, 7);
    x13 ^= rotl(x09 + x05 | 0, 9);
    x01 ^= rotl(x13 + x09 | 0, 13);
    x05 ^= rotl(x01 + x13 | 0, 18);
    x14 ^= rotl(x10 + x06 | 0, 7);
    x02 ^= rotl(x14 + x10 | 0, 9);
    x06 ^= rotl(x02 + x14 | 0, 13);
    x10 ^= rotl(x06 + x02 | 0, 18);
    x03 ^= rotl(x15 + x11 | 0, 7);
    x07 ^= rotl(x03 + x15 | 0, 9);
    x11 ^= rotl(x07 + x03 | 0, 13);
    x15 ^= rotl(x11 + x07 | 0, 18);
    x01 ^= rotl(x00 + x03 | 0, 7);
    x02 ^= rotl(x01 + x00 | 0, 9);
    x03 ^= rotl(x02 + x01 | 0, 13);
    x00 ^= rotl(x03 + x02 | 0, 18);
    x06 ^= rotl(x05 + x04 | 0, 7);
    x07 ^= rotl(x06 + x05 | 0, 9);
    x04 ^= rotl(x07 + x06 | 0, 13);
    x05 ^= rotl(x04 + x07 | 0, 18);
    x11 ^= rotl(x10 + x09 | 0, 7);
    x08 ^= rotl(x11 + x10 | 0, 9);
    x09 ^= rotl(x08 + x11 | 0, 13);
    x10 ^= rotl(x09 + x08 | 0, 18);
    x12 ^= rotl(x15 + x14 | 0, 7);
    x13 ^= rotl(x12 + x15 | 0, 9);
    x14 ^= rotl(x13 + x12 | 0, 13);
    x15 ^= rotl(x14 + x13 | 0, 18);
  }
  let oi = 0;
  out[oi++] = y00 + x00 | 0;
  out[oi++] = y01 + x01 | 0;
  out[oi++] = y02 + x02 | 0;
  out[oi++] = y03 + x03 | 0;
  out[oi++] = y04 + x04 | 0;
  out[oi++] = y05 + x05 | 0;
  out[oi++] = y06 + x06 | 0;
  out[oi++] = y07 + x07 | 0;
  out[oi++] = y08 + x08 | 0;
  out[oi++] = y09 + x09 | 0;
  out[oi++] = y10 + x10 | 0;
  out[oi++] = y11 + x11 | 0;
  out[oi++] = y12 + x12 | 0;
  out[oi++] = y13 + x13 | 0;
  out[oi++] = y14 + x14 | 0;
  out[oi++] = y15 + x15 | 0;
}
function hsalsa(s, k, i, out) {
  const s2 = isLE ? s : swap32IfBE(s.slice(0, 4));
  const k2 = isLE ? k : swap32IfBE(k.slice(0, 8));
  const i2 = isLE ? i : swap32IfBE(i.slice(0, 4));
  const t = new Uint32Array(16);
  salsaCore(s2, k2, i2.subarray(0, 2), t, i2[2], 20, i2[3]);
  let oi = 0;
  out[oi++] = t[0] - s2[0] | 0;
  out[oi++] = t[5] - s2[1] | 0;
  out[oi++] = t[10] - s2[2] | 0;
  out[oi++] = t[15] - s2[3] | 0;
  out[oi++] = t[6] - i2[0] | 0;
  out[oi++] = t[7] - i2[1] | 0;
  out[oi++] = t[8] - i2[2] | 0;
  out[oi++] = t[9] - i2[3] | 0;
  swap32IfBE(out);
  if (!isLE)
    clean(s2, k2, i2);
  clean(t);
}
var xsalsa20 = /* @__PURE__ */ createCipher(salsaCore, {
  counterRight: true,
  extendNonceFn: hsalsa
});
var xsalsa20poly1305 = /* @__PURE__ */ wrapCipher({ blockSize: 64, nonceLength: 24, tagLength: 16 }, (key, nonce) => {
  return {
    encrypt(plaintext, output) {
      output = getOutput(plaintext.length + 32, output, false);
      const authKey = output.subarray(0, 32);
      const ciphPlaintext = output.subarray(32);
      output.set(plaintext, 32);
      clean(authKey);
      xsalsa20(key, nonce, output, output);
      const tag = poly1305(ciphPlaintext, authKey);
      output.set(tag, 16);
      clean(output.subarray(0, 16), tag);
      return output.subarray(16);
    },
    decrypt(ciphertext, output) {
      abytes(ciphertext, void 0, "data");
      output = getOutput(ciphertext.length + 32, output, false);
      const tmp = output.subarray(0, 32);
      const passedTag = output.subarray(32, 48);
      const ciphPlaintext = output.subarray(48);
      output.set(ciphertext, 32);
      clean(tmp);
      const authKey = xsalsa20(key, nonce, tmp, tmp);
      const tag = poly1305(ciphPlaintext, authKey);
      if (!equalBytes(passedTag, tag)) {
        clean(output);
        throw new Error("invalid tag");
      }
      xsalsa20(key, nonce, output.subarray(16), output.subarray(16));
      clean(tmp, passedTag, tag);
      return ciphPlaintext;
    }
  };
});

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/_blake.js
var BSIGMA = /* @__PURE__ */ Uint8Array.from([
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9,
  12,
  5,
  1,
  15,
  14,
  13,
  4,
  10,
  0,
  7,
  6,
  3,
  9,
  2,
  8,
  11,
  13,
  11,
  7,
  14,
  12,
  1,
  3,
  9,
  5,
  0,
  15,
  4,
  8,
  6,
  2,
  10,
  6,
  15,
  14,
  9,
  11,
  3,
  0,
  8,
  12,
  2,
  13,
  7,
  1,
  4,
  10,
  5,
  10,
  2,
  8,
  4,
  7,
  6,
  1,
  5,
  15,
  11,
  9,
  14,
  3,
  12,
  13,
  0,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  // Blake1, unused in others
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9
]);

// ../../../../../SnapVault/snapvault/node_modules/.pnpm/@noble+hashes@2.4.0/node_modules/@noble/hashes/blake2.js
var B2B_IV = /* @__PURE__ */ Uint32Array.from([
  4089235720,
  1779033703,
  2227873595,
  3144134277,
  4271175723,
  1013904242,
  1595750129,
  2773480762,
  2917565137,
  1359893119,
  725511199,
  2600822924,
  4215389547,
  528734635,
  327033209,
  1541459225
]);
var BBUF = /* @__PURE__ */ new Uint32Array(32);
function G1b(a, b, c, d, msg, x) {
  const Xl = msg[x], Xh = msg[x + 1];
  let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
  let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
  let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
  let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
  const ll = add3L(Al, Bl, Xl);
  Ah = add3H(ll, Ah, Bh, Xh);
  Al = ll | 0;
  let xh = Dh ^ Ah, xl = Dl ^ Al;
  Dh = rotr32H(xh, xl);
  Dl = rotr32L(xh, xl);
  ({ h: Ch, l: Cl } = add(Ch, Cl, Dh, Dl));
  xh = Bh ^ Ch;
  xl = Bl ^ Cl;
  Bh = rotrSH(xh, xl, 24);
  Bl = rotrSL(xh, xl, 24);
  BBUF[2 * a] = Al;
  BBUF[2 * a + 1] = Ah;
  BBUF[2 * b] = Bl;
  BBUF[2 * b + 1] = Bh;
  BBUF[2 * c] = Cl;
  BBUF[2 * c + 1] = Ch;
  BBUF[2 * d] = Dl;
  BBUF[2 * d + 1] = Dh;
}
function G2b(a, b, c, d, msg, x) {
  const Xl = msg[x], Xh = msg[x + 1];
  let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
  let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
  let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
  let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
  const ll = add3L(Al, Bl, Xl);
  Ah = add3H(ll, Ah, Bh, Xh);
  Al = ll | 0;
  let xh = Dh ^ Ah, xl = Dl ^ Al;
  Dh = rotrSH(xh, xl, 16);
  Dl = rotrSL(xh, xl, 16);
  ({ h: Ch, l: Cl } = add(Ch, Cl, Dh, Dl));
  xh = Bh ^ Ch;
  xl = Bl ^ Cl;
  Bh = rotrBH(xh, xl, 63);
  Bl = rotrBL(xh, xl, 63);
  BBUF[2 * a] = Al;
  BBUF[2 * a + 1] = Ah;
  BBUF[2 * b] = Bl;
  BBUF[2 * b + 1] = Bh;
  BBUF[2 * c] = Cl;
  BBUF[2 * c + 1] = Ch;
  BBUF[2 * d] = Dl;
  BBUF[2 * d + 1] = Dh;
}
function checkBlake2Opts(outputLen, opts = {}, keyLen, saltLen, persLen) {
  anumber2(keyLen);
  if (outputLen <= 0 || outputLen > keyLen)
    throw new Error('"dkLen" must be 1..' + keyLen + ", got " + outputLen);
  const { key, salt, personalization } = opts;
  if (key !== void 0 && (key.length < 1 || key.length > keyLen))
    throw new Error('"key" expected to be undefined or of length=1..' + keyLen);
  if (salt !== void 0)
    abytes2(salt, saltLen, "salt");
  if (personalization !== void 0)
    abytes2(personalization, persLen, "personalization");
}
var _BLAKE2 = class {
  buffer;
  buffer32;
  finished = false;
  destroyed = false;
  length = 0;
  pos = 0;
  blockLen;
  outputLen;
  canXOF = false;
  constructor(blockLen, outputLen) {
    anumber2(blockLen);
    anumber2(outputLen);
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.buffer = new Uint8Array(blockLen);
    this.buffer32 = u322(this.buffer);
  }
  update(data) {
    aexists2(this);
    abytes2(data);
    const { blockLen, buffer, buffer32 } = this;
    const len = data.length;
    const offset = data.byteOffset;
    const buf = data.buffer;
    for (let pos = 0; pos < len; ) {
      if (this.pos === blockLen) {
        swap32IfBE2(buffer32);
        this.compress(buffer32, 0, false);
        swap32IfBE2(buffer32);
        this.pos = 0;
      }
      const take = Math.min(blockLen - this.pos, len - pos);
      const dataOffset = offset + pos;
      if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
        const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
        swap32IfBE2(data32);
        for (let pos32 = 0; pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
          this.length += blockLen;
          this.compress(data32, pos32, false);
        }
        swap32IfBE2(data32);
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      this.length += take;
      pos += take;
    }
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    if (out.byteOffset & 3)
      throw new RangeError('"output" expected 4-byte aligned byteOffset, got ' + out.byteOffset);
    const { pos, buffer32 } = this;
    this.finished = true;
    this.buffer.fill(0, pos);
    swap32IfBE2(buffer32);
    this.compress(buffer32, 0, true);
    swap32IfBE2(buffer32);
    const state = this.get();
    const out32 = out === this.buffer ? buffer32 : u322(out);
    const full2 = Math.floor(this.outputLen / 4);
    for (let i = 0; i < full2; i++)
      out32[i] = swap8IfBE(state[i]);
    const tail = this.outputLen % 4;
    if (!tail)
      return;
    const off = full2 * 4;
    const word2 = state[full2];
    for (let i = 0; i < tail; i++)
      out[off + i] = word2 >>> 8 * i;
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    const { buffer, length, finished, destroyed, outputLen, pos } = this;
    to ||= new this.constructor({ dkLen: outputLen });
    to.set(...this.get());
    to.buffer.set(buffer);
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    to.outputLen = outputLen;
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var _BLAKE2b = class extends _BLAKE2 {
  // Same IV words as SHA-512 / BLAKE2b, encoded as LE u32 low/high halves.
  v0l = B2B_IV[0] | 0;
  v0h = B2B_IV[1] | 0;
  v1l = B2B_IV[2] | 0;
  v1h = B2B_IV[3] | 0;
  v2l = B2B_IV[4] | 0;
  v2h = B2B_IV[5] | 0;
  v3l = B2B_IV[6] | 0;
  v3h = B2B_IV[7] | 0;
  v4l = B2B_IV[8] | 0;
  v4h = B2B_IV[9] | 0;
  v5l = B2B_IV[10] | 0;
  v5h = B2B_IV[11] | 0;
  v6l = B2B_IV[12] | 0;
  v6h = B2B_IV[13] | 0;
  v7l = B2B_IV[14] | 0;
  v7h = B2B_IV[15] | 0;
  constructor(opts = {}) {
    opts = checkOpts2({}, opts);
    const olen = opts.dkLen === void 0 ? 64 : opts.dkLen;
    super(128, olen);
    checkBlake2Opts(olen, opts, 64, 16, 16);
    let { key, personalization, salt } = opts;
    let keyLength = 0;
    if (key !== void 0) {
      abytes2(key, void 0, "key");
      keyLength = key.length;
    }
    this.v0l ^= this.outputLen | keyLength << 8 | 1 << 16 | 1 << 24;
    if (salt !== void 0) {
      abytes2(salt, void 0, "salt");
      const slt = u322(copyBytes2(salt));
      this.v4l ^= swap8IfBE(slt[0]);
      this.v4h ^= swap8IfBE(slt[1]);
      this.v5l ^= swap8IfBE(slt[2]);
      this.v5h ^= swap8IfBE(slt[3]);
    }
    if (personalization !== void 0) {
      abytes2(personalization, void 0, "personalization");
      const pers = u322(copyBytes2(personalization));
      this.v6l ^= swap8IfBE(pers[0]);
      this.v6h ^= swap8IfBE(pers[1]);
      this.v7l ^= swap8IfBE(pers[2]);
      this.v7h ^= swap8IfBE(pers[3]);
    }
    if (key !== void 0) {
      const tmp = new Uint8Array(this.blockLen);
      tmp.set(key);
      this.update(tmp);
      clean2(tmp);
    }
  }
  // prettier-ignore
  get() {
    let { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
    return [v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h];
  }
  // prettier-ignore
  set(v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h) {
    this.v0l = v0l | 0;
    this.v0h = v0h | 0;
    this.v1l = v1l | 0;
    this.v1h = v1h | 0;
    this.v2l = v2l | 0;
    this.v2h = v2h | 0;
    this.v3l = v3l | 0;
    this.v3h = v3h | 0;
    this.v4l = v4l | 0;
    this.v4h = v4h | 0;
    this.v5l = v5l | 0;
    this.v5h = v5h | 0;
    this.v6l = v6l | 0;
    this.v6h = v6h | 0;
    this.v7l = v7l | 0;
    this.v7h = v7h | 0;
  }
  compress(msg, offset, isLast) {
    const { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
    {
      BBUF[0] = v0l;
      BBUF[1] = v0h;
      BBUF[2] = v1l;
      BBUF[3] = v1h;
      BBUF[4] = v2l;
      BBUF[5] = v2h;
      BBUF[6] = v3l;
      BBUF[7] = v3h;
      BBUF[8] = v4l;
      BBUF[9] = v4h;
      BBUF[10] = v5l;
      BBUF[11] = v5h;
      BBUF[12] = v6l;
      BBUF[13] = v6h;
      BBUF[14] = v7l;
      BBUF[15] = v7h;
    }
    BBUF.set(B2B_IV, 16);
    const l = fromNumL(this.length);
    const h = fromNumH(this.length);
    BBUF[24] = B2B_IV[8] ^ l;
    BBUF[25] = B2B_IV[9] ^ h;
    if (isLast) {
      BBUF[28] = ~BBUF[28];
      BBUF[29] = ~BBUF[29];
    }
    let j = 0;
    const s = BSIGMA;
    for (let i = 0; i < 12; i++) {
      G1b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
      G2b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
      G1b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
      G2b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
      G1b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
      G2b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
      G1b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
      G2b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
      G1b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
      G2b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
      G1b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
      G2b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
      G1b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
      G2b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
      G1b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
      G2b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
    }
    this.v0l ^= BBUF[0] ^ BBUF[16];
    this.v0h ^= BBUF[1] ^ BBUF[17];
    this.v1l ^= BBUF[2] ^ BBUF[18];
    this.v1h ^= BBUF[3] ^ BBUF[19];
    this.v2l ^= BBUF[4] ^ BBUF[20];
    this.v2h ^= BBUF[5] ^ BBUF[21];
    this.v3l ^= BBUF[6] ^ BBUF[22];
    this.v3h ^= BBUF[7] ^ BBUF[23];
    this.v4l ^= BBUF[8] ^ BBUF[24];
    this.v4h ^= BBUF[9] ^ BBUF[25];
    this.v5l ^= BBUF[10] ^ BBUF[26];
    this.v5h ^= BBUF[11] ^ BBUF[27];
    this.v6l ^= BBUF[12] ^ BBUF[28];
    this.v6h ^= BBUF[13] ^ BBUF[29];
    this.v7l ^= BBUF[14] ^ BBUF[30];
    this.v7h ^= BBUF[15] ^ BBUF[31];
    clean2(BBUF);
  }
  destroy() {
    this.destroyed = true;
    clean2(this.buffer32);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var blake2b = /* @__PURE__ */ createHasher((opts) => new _BLAKE2b(opts));

// vendor/taperelay-client/src/sealedbox.mjs
var P = (1n << 255n) - 19n;
var SIGMA = view32(new TextEncoder().encode("expand 32-byte k"));
var PROBE = Uint8Array.from({ length: 32 }, (_, i) => i * 29 + 7 & 255);
function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}
var concat2 = (a, b) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};
var isZero = (b) => b.every((x) => x === 0);
function view32(bytes) {
  const copy = Uint8Array.from(bytes);
  return new Uint32Array(copy.buffer, 0, copy.length / 4);
}
function checkPublicKey(pk) {
  if (!(pk instanceof Uint8Array) || pk.length !== 32) return "non-canonical";
  let n = 0n;
  for (let i = 31; i >= 0; i--) n = n << 8n | BigInt(pk[i]);
  if (n >= P) return "non-canonical";
  try {
    if (isZero(x25519.getSharedSecret(PROBE, pk))) return "small-order";
  } catch {
    return "small-order";
  }
  return "ok";
}
function boxKey(secretKey, publicKey) {
  let shared;
  try {
    shared = x25519.getSharedSecret(secretKey, publicKey);
  } catch {
    fail("bad-public-key", "\u5171\u4EAB\u5BC6\u94A5\u662F\u5168\u96F6\uFF08\u5BF9\u65B9\u7684\u516C\u94A5\u662F\u5C0F\u9636\u70B9\uFF0CFiles \xA75.6\uFF09");
  }
  if (isZero(shared)) fail("bad-public-key", "\u5171\u4EAB\u5BC6\u94A5\u662F\u5168\u96F6\uFF08\u5BF9\u65B9\u7684\u516C\u94A5\u662F\u5C0F\u9636\u70B9\uFF0CFiles \xA75.6\uFF09");
  const k = view32(shared);
  shared.fill(0);
  const out = new Uint32Array(8);
  hsalsa(SIGMA, k, new Uint32Array(4), out);
  k.fill(0);
  return new Uint8Array(out.buffer);
}
var publicKeyOf = (secretKey) => x25519.getPublicKey(secretKey);
function sealBox(message, recipientPublicKey, { ephemeralSecret } = {}) {
  const why = checkPublicKey(recipientPublicKey);
  if (why !== "ok") fail("bad-public-key", `\u6536\u4EF6\u4EBA\u7684\u52A0\u5BC6\u516C\u94A5\u4E0D\u5408\u683C\uFF08${why}\uFF0CTapeRelay \xA74.4\uFF09`);
  const esk = ephemeralSecret ?? crypto.getRandomValues(new Uint8Array(32));
  let key;
  try {
    const epk = x25519.getPublicKey(esk);
    const nonce = blake2b(concat2(epk, recipientPublicKey), { dkLen: 24 });
    key = boxKey(esk, recipientPublicKey);
    return concat2(epk, xsalsa20poly1305(key, nonce).encrypt(message));
  } finally {
    key?.fill(0);
    if (!ephemeralSecret) esk.fill(0);
  }
}
function openBox(sealed, publicKey, secretKey) {
  if (!(sealed instanceof Uint8Array) || sealed.length < 48) return null;
  let key;
  try {
    const epk = sealed.subarray(0, 32);
    const nonce = blake2b(concat2(epk, publicKey), { dkLen: 24 });
    key = boxKey(secretKey, epk);
    return xsalsa20poly1305(key, nonce).decrypt(sealed.subarray(32));
  } catch {
    return null;
  } finally {
    key?.fill(0);
  }
}

// vendor/taperelay-client/src/encrypted.mjs
var OBJECT_MAX = 1048576;
var MAGIC = utf8(constants_default.envelopeMagic);
var SLOT = 80;
var SLOT_STEPS = [2, 4, 8, 16];
function fail2(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}
var rand = (n, random) => random ? random(n) : crypto.getRandomValues(new Uint8Array(n));
var u32be = (n) => Uint8Array.of(n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255);
var eqBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function generateKeyPair({ random } = {}) {
  const secretKey = rand(32, random);
  return { secretKey, publicKey: publicKeyOf(secretKey) };
}
var chunkAad = (i, last) => concat(utf8(constants_default.labels.chunk), u32be(i), Uint8Array.of(last ? 1 : 0));
var indexAad = (level, position) => concat(utf8(constants_default.labels.index), Uint8Array.of(level), u32be(position));
function encryptObject(key, aad, plaintext, nonce = crypto.getRandomValues(new Uint8Array(24))) {
  return concat(nonce, xchacha20poly1305(key, nonce, aad).encrypt(plaintext));
}
function decryptObject(key, aad, obj) {
  if (!(obj instanceof Uint8Array) || obj.length < 40) fail2("undecryptable", "\u5BF9\u8C61\u592A\u77ED\uFF0C\u89E3\u4E0D\u5F00");
  try {
    return xchacha20poly1305(key, obj.subarray(0, 24), aad).decrypt(obj.subarray(24));
  } catch {
    return fail2("undecryptable", "\u89E3\u4E0D\u5F00\uFF08\u5BC6\u94A5\u3001\u9644\u52A0\u6570\u636E\u4E0D\u5BF9\uFF0C\u6216\u5BF9\u8C61\u88AB\u6539\u8FC7\uFF09");
  }
}
function lastChunkPadTarget(len) {
  let t = 4096;
  while (t < len) t *= 2;
  return Math.min(t, ENCRYPTED_CHUNK);
}
var slotPadTarget = (n) => SLOT_STEPS.find((s) => s >= n) ?? fail2("too-many-recipients", "\u6536\u4EF6\u4EBA\uFF08\u8FDE\u540C\u81EA\u5DF1\uFF09\u6700\u591A 16 \u4E2A\uFF08Files \xA75.6\uFF09");
function openChunk(obj, i, last, key, lastLen) {
  const pt = decryptObject(key, chunkAad(i, last), obj);
  if (!last) {
    if (pt.length !== ENCRYPTED_CHUNK) fail2("bad-length", `\u7B2C ${i} \u5757\u7684\u957F\u5EA6\u4E0D\u5BF9\uFF08Files \xA75.2\uFF09`);
    return pt;
  }
  if (!Number.isInteger(lastLen) || lastLen < 1 || pt.length < lastLen || pt.length > ENCRYPTED_CHUNK) fail2("bad-length", "\u6700\u540E\u4E00\u5757\u7684\u957F\u5EA6\u4E0D\u5BF9\uFF08Files \xA75.2\uFF09");
  if (pt.subarray(lastLen).some((x) => x !== 0)) fail2("bad-padding", "\u6700\u540E\u4E00\u5757\u8865\u7684\u5B57\u8282\u4E0D\u5168\u662F\u96F6\uFF08Files \xA75.2\uFF09");
  return pt.subarray(0, lastLen);
}
function openIndex(obj, level, position, entries, key) {
  const pt = decryptObject(key, indexAad(level, position), obj);
  if (pt.length !== entries * 32) fail2("bad-length", "\u7D22\u5F15\u5BF9\u8C61\u7684\u957F\u5EA6\u4E0D\u5BF9\uFF08Files \xA75.3\uFF09");
  return pt;
}
var commitmentOf = (fileKey) => sha256(concat(utf8(constants_default.labels.commit), fileKey));
function buildEnvelope({ fileKey, slots, manifestBytes, nonce = crypto.getRandomValues(new Uint8Array(24)) }) {
  if (slots.length < 1 || slots.length > 16 || slots.some((s) => s.length !== SLOT)) fail2("bad-count", "\u4EFD\u6570\u8981\u5728 1\uFF5E16 \u4E4B\u95F4\uFF0C\u6BCF\u4EFD 80 \u5B57\u8282\uFF08Files \xA75.6\uFF09");
  const header = concat(MAGIC, Uint8Array.of(1, slots.length), commitmentOf(fileKey), ...slots, nonce);
  const env = concat(header, xchacha20poly1305(fileKey, nonce, header).encrypt(manifestBytes));
  if (env.length > OBJECT_MAX) fail2("too-large", "\u4FE1\u5C01\u8D85\u8FC7 1 MiB");
  return env;
}
function openEnvelope(bytes, keyPairs) {
  const n = envelopeSlots(bytes);
  let fileKey = null;
  for (let i = 0; i < n && !fileKey; i++) {
    const slot = bytes.subarray(38 + 80 * i, 118 + 80 * i);
    for (const kp of keyPairs) {
      const k = openBox(slot, kp.publicKey, kp.secretKey);
      if (k && k.length === 32) {
        fileKey = k;
        break;
      }
    }
  }
  if (!fileKey) fail2("no-slot", "\u6CA1\u6709\u4E00\u4EFD\u662F\u7ED9\u81EA\u5DF1\u7684");
  try {
    return { fileKey, ...manifestOfEnvelope(bytes, n, fileKey) };
  } catch (e) {
    fileKey.fill(0);
    throw e;
  }
}
function openEnvelopeWithKey(bytes, fileKey) {
  if (!(fileKey instanceof Uint8Array) || fileKey.length !== 32) fail2("bad-key", "\u6587\u4EF6\u94A5\u5319\u8981\u662F 32 \u5B57\u8282");
  return manifestOfEnvelope(bytes, envelopeSlots(bytes), fileKey);
}
function envelopeSlots(bytes) {
  if (!(bytes instanceof Uint8Array)) fail2("bad-length", "\u4FE1\u5C01\u4E0D\u662F\u5B57\u8282");
  if (bytes.length > OBJECT_MAX) fail2("too-large", "\u4FE1\u5C01\u8D85\u8FC7 1 MiB");
  if (bytes.length < 6) fail2("bad-length", "\u4FE1\u5C01\u592A\u77ED");
  if (!eqBytes(bytes.subarray(0, 4), MAGIC)) fail2("bad-magic", "\u9B54\u6570\u4E0D\u5BF9\uFF08Files \xA75.6\uFF09");
  if (bytes[4] !== 1) fail2("bad-version", "\u4FE1\u5C01\u7684\u7248\u672C\u4E0D\u8BA4\u8BC6\uFF08Files \xA75.6\uFF09");
  const n = bytes[5];
  if (n < 1 || n > 16) fail2("bad-count", "\u4EFD\u6570\u4E0D\u5728 1\uFF5E16 \u4E4B\u95F4\uFF08Files \xA75.6\uFF09");
  if (bytes.length < 78 + 80 * n) fail2("bad-length", "\u4FE1\u5C01\u7684\u957F\u5EA6\u5BF9\u4E0D\u4E0A\uFF08Files \xA75.6\uFF09");
  return n;
}
function manifestOfEnvelope(bytes, n, fileKey) {
  if (!eqBytes(commitmentOf(fileKey), bytes.subarray(6, 38))) fail2("commitment-mismatch", "\u6587\u4EF6\u5BC6\u94A5\u4E0E\u627F\u8BFA\u503C\u4E0D\u7B26\uFF0C\u6574\u4E2A\u4FE1\u5C01\u62D2\u7EDD\uFF08Files \xA75.6\uFF09");
  const end = 62 + 80 * n;
  let plain, manifestJson;
  try {
    plain = xchacha20poly1305(fileKey, bytes.subarray(end - 24, end), bytes.subarray(0, end)).decrypt(bytes.subarray(end));
  } catch {
    fail2("manifest-undecryptable", "\u6E05\u5355\u89E3\u4E0D\u5F00\uFF08Files \xA75.6\uFF09");
  }
  try {
    manifestJson = new TextDecoder("utf-8", { fatal: true }).decode(plain);
  } catch {
    fail2("bad-manifest", "\u6E05\u5355\u4E0D\u662F\u5408\u6CD5\u7684 UTF-8\uFF08Files \xA73\uFF09");
  }
  const { manifest, error } = checkManifest(manifestJson);
  if (error || manifest.type !== "encrypted") fail2("bad-manifest", error ?? "\u4FE1\u5C01\u91CC\u7684\u6E05\u5355\u4E0D\u662F\u52A0\u5BC6\u6587\u4EF6\u7684\uFF08Files \xA75.6\uFF09");
  return { manifest, manifestJson };
}
async function planEncryptedFile(input, { name = "", contentType = "application/octet-stream", from, selfKey, to = [], wholeSha256 = false, padLast = true, padSlots = true, random } = {}) {
  if (typeof from === "string") from = normalizeCircuitInput(from) ?? from;
  if (!isAccount(from)) fail2("bad-address", "from \u8981\u662F\u7535\u8DEF\u540D\uFF0C\u4F8B\u5982 1.2.0\uFF08TapeRelay \xA73.2\u3001Files \xA75.5\uFF09");
  const recipients = [];
  for (const pk of [selfKey, ...to]) {
    const why = checkPublicKey(pk);
    if (why !== "ok") fail2("bad-public-key", `\u52A0\u5BC6\u516C\u94A5\u4E0D\u5408\u683C\uFF08${why}\uFF0CTapeRelay \xA74.4\uFF09`);
    if (!recipients.some((r) => eqBytes(r, pk))) recipients.push(pk);
  }
  if (recipients.length > 16) fail2("too-many-recipients", "\u6536\u4EF6\u4EBA\uFF08\u8FDE\u540C\u81EA\u5DF1\uFF09\u6700\u591A 16 \u4E2A\uFF08Files \xA75.6\uFF09");
  const source = sourceOf(input);
  const l = layoutOf(source.size, ENCRYPTED_CHUNK);
  if (!l) fail2("bad-size", "\u6587\u4EF6\u5927\u5C0F\u8981\u5728 1 \u5B57\u8282\u5230\u4E24\u5C42\u7D22\u5F15\u7684\u4E0A\u9650\u4E4B\u95F4\uFF08Files \xA73\u3001Files \xA75.2\uFF1Bv0.1 \u4E0D\u652F\u6301\u7A7A\u6587\u4EF6\uFF09");
  const { n, levels, lower } = l;
  const lastLen = source.size - (n - 1) * ENCRYPTED_CHUNK;
  const fileKey = rand(32, random);
  const nonces = [];
  const chunkHashes = [];
  const whole = wholeSha256 ? sha256.create() : null;
  const plainChunk = plainChunkOf(source, n, padLast);
  for (let i = 0; i < n; i++) {
    const pt = await plainChunk(i);
    whole?.update(i === n - 1 ? pt.subarray(0, lastLen) : pt);
    const nonce = rand(24, random);
    nonces.push(nonce);
    chunkHashes.push(sha256Hex(encryptObject(fileKey, chunkAad(i, i === n - 1), pt, nonce)));
  }
  const enc3 = (level, position, plain) => {
    const bytes = encryptObject(fileKey, indexAad(level, position), plain, rand(24, random));
    return { bytes, sha256: sha256Hex(bytes), level, position };
  };
  let indexObjects;
  if (levels === 1) indexObjects = [enc3(0, 0, concat(...chunkHashes.map(fromHex)))];
  else {
    const lowers = Array.from({ length: lower }, (_, j) => enc3(1, j, concat(...chunkHashes.slice(j * FANOUT, (j + 1) * FANOUT).map(fromHex))));
    indexObjects = [enc3(0, 0, concat(...lowers.map((o) => fromHex(o.sha256)))), ...lowers];
  }
  const fileId = indexObjects[0].sha256;
  const manifest = { version: 1, type: "encrypted", name: String(name), contentType: contentTypeOf(contentType), size: source.size, chunkSize: ENCRYPTED_CHUNK, index: fileId };
  if (whole) manifest.sha256 = hex(whole.digest());
  manifest.from = from;
  const manifestJson = JSON.stringify(manifest);
  if (utf8(manifestJson).length > MAX_MANIFEST) fail2("bad-manifest", "\u6E05\u5355\u8D85\u8FC7 16 KiB\uFF08\u6587\u4EF6\u540D\u592A\u957F\uFF1F\uFF09");
  const slots = recipients.map((pk) => sealBox(fileKey, pk, random ? { ephemeralSecret: random(32) } : {}));
  const target = padSlots ? slotPadTarget(slots.length) : slots.length;
  while (slots.length < target) slots.push(rand(SLOT, random));
  for (let i = slots.length - 1; i > 0; i--) {
    const j = rand(1, random)[0] % (i + 1);
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const envBytes = buildEnvelope({ fileKey, slots, manifestBytes: utf8(manifestJson), nonce: rand(24, random) });
  const envelope = { bytes: envBytes, sha256: sha256Hex(envBytes) };
  return planOf({ source, fileKey, chunkHashes, indexObjects, manifest, manifestJson, envelope, nonces, n, plainChunk });
}
function plainChunkOf(source, n, padLast) {
  return async (i) => {
    const pt = await source.read(i * ENCRYPTED_CHUNK, Math.min(source.size, (i + 1) * ENCRYPTED_CHUNK));
    if (i < n - 1 || !padLast) return pt;
    const padded = new Uint8Array(lastChunkPadTarget(pt.length));
    padded.set(pt);
    return padded;
  };
}
function planOf({ source, fileKey, chunkHashes, indexObjects, manifest, manifestJson, envelope, nonces, n, plainChunk }) {
  return {
    source,
    fileKey,
    chunkHashes,
    indexObjects,
    manifest,
    manifestJson,
    envelope,
    fileId: indexObjects[0].sha256,
    extraObjects: [envelope],
    // 上传时最后传（uploadFile）：信封在了，其余对象就都在了
    nonces,
    // 第 409 条：每块的 nonce（不是秘密，本来就在每块的开头），接着传时要用（resumableOf）
    /** 第 i 块加密后的字节：用同一个 nonce 重新加密，核对哈希与计划相同才交出（原文件变了就抛错，不交出） */
    async chunkBytes(i) {
      if (fileKey.every((x) => x === 0)) fail2("disposed", "\u8BA1\u5212\u5DF2\u7ECF dispose\uFF0C\u6587\u4EF6\u5BC6\u94A5\u5DF2\u6E05\u6389");
      const obj = encryptObject(fileKey, chunkAad(i, i === n - 1), await plainChunk(i), nonces[i]);
      if (sha256Hex(obj) !== chunkHashes[i]) fail2("source-changed", `\u7B2C ${i} \u5757\u7684\u539F\u6587\u5728\u8BA1\u5212\u4E4B\u540E\u53D8\u4E86\uFF0C\u8FD9\u5757\u4E0D\u4E0A\u4F20`);
      return obj;
    },
    /** 用完清掉内存里的文件密钥（JavaScript 不保证没有别的副本，尽量而为） */
    dispose() {
      fileKey.fill(0);
    }
  };
}
function resumableOf(plan) {
  return { envelope: plan.envelope.bytes, index: plan.indexObjects.map((o) => o.bytes), nonces: concat(...plan.nonces) };
}
async function planEncryptedResume(input, { saved, keyPairs, padLast = true }) {
  const mismatch = (why) => fail2("resume-mismatch", `\u63A5\u4E0D\u4E0A\u4E0A\u6B21\u6CA1\u4F20\u5B8C\u7684\u8FD9\u4E2A\u52A0\u5BC6\u6587\u4EF6\uFF1A${why}`);
  if (!(saved?.envelope instanceof Uint8Array) || !Array.isArray(saved.index) || !saved.index.length || !saved.index.every((b) => b instanceof Uint8Array) || !(saved.nonces instanceof Uint8Array)) mismatch("\u5B58\u4E0B\u7684\u8BB0\u5F55\u683C\u5F0F\u4E0D\u5BF9");
  let opened;
  try {
    opened = openEnvelope(saved.envelope, keyPairs);
  } catch (e) {
    mismatch(`\u4FE1\u5C01\u6253\u4E0D\u5F00\uFF08${e?.code ?? e?.message}\uFF09`);
  }
  const { fileKey, manifest, manifestJson } = opened;
  try {
    const source = sourceOf(input);
    if (manifest.size !== source.size || manifest.chunkSize !== ENCRYPTED_CHUNK) mismatch("\u6587\u4EF6\u5927\u5C0F\u4E0E\u4E0A\u6B21\u4E0D\u540C");
    const { n, levels, lower } = layoutOf(source.size, ENCRYPTED_CHUNK);
    if (saved.nonces.length !== n * 24 || saved.index.length !== (levels === 1 ? 1 : 1 + lower)) mismatch("\u5B58\u4E0B\u7684\u7D22\u5F15\u3001nonce \u4E2A\u6570\u5BF9\u4E0D\u4E0A");
    const indexObjects = saved.index.map((bytes, k) => ({ bytes, sha256: sha256Hex(bytes), level: k === 0 ? 0 : 1, position: k === 0 ? 0 : k - 1 }));
    if (indexObjects[0].sha256 !== manifest.index) mismatch("\u9876\u5C42\u7D22\u5F15\u4E0E\u6E05\u5355\u4E0D\u7B26");
    const hashesIn = (b) => Array.from({ length: b.length / 32 }, (_, i) => hex(b.subarray(i * 32, i * 32 + 32)));
    let chunkHashes;
    try {
      const top = hashesIn(openIndex(indexObjects[0].bytes, 0, 0, levels === 1 ? n : lower, fileKey));
      if (levels === 1) chunkHashes = top;
      else {
        chunkHashes = [];
        for (let j = 0; j < lower; j++) {
          if (indexObjects[j + 1].sha256 !== top[j]) mismatch(`\u7B2C ${j} \u4E2A\u4E0B\u5C42\u7D22\u5F15\u4E0E\u9876\u5C42\u5217\u7684\u4E0D\u7B26`);
          chunkHashes.push(...hashesIn(openIndex(indexObjects[j + 1].bytes, 1, j, Math.min(FANOUT, n - j * FANOUT), fileKey)));
        }
      }
    } catch (e) {
      if (e?.code === "resume-mismatch") throw e;
      mismatch(`\u7D22\u5F15\u89E3\u4E0D\u5F00\uFF08${e?.code ?? e?.message}\uFF09`);
    }
    const nonces = Array.from({ length: n }, (_, i) => saved.nonces.slice(i * 24, i * 24 + 24));
    const plainChunk = plainChunkOf(source, n, padLast);
    const lastLen = source.size - (n - 1) * ENCRYPTED_CHUNK;
    const whole = manifest.sha256 ? sha256.create() : null;
    for (let i = 0; i < n; i++) {
      const pt = await plainChunk(i);
      whole?.update(i === n - 1 ? pt.subarray(0, lastLen) : pt);
      if (sha256Hex(encryptObject(fileKey, chunkAad(i, i === n - 1), pt, nonces[i])) !== chunkHashes[i]) mismatch(`\u7B2C ${i} \u5757\u4E0E\u4E0A\u6B21\u7684\u4E0D\u540C\uFF08\u4E0D\u662F\u540C\u4E00\u4E2A\u6587\u4EF6\uFF09`);
    }
    if (whole && hex(whole.digest()) !== manifest.sha256) mismatch("\u6574\u4E2A\u6587\u4EF6\u7684 SHA-256 \u4E0E\u4E0A\u6B21\u4E0D\u540C");
    const envelope = { bytes: saved.envelope, sha256: sha256Hex(saved.envelope) };
    return planOf({ source, fileKey, chunkHashes, indexObjects, manifest, manifestJson, envelope, nonces, n, plainChunk });
  } catch (e) {
    fileKey.fill(0);
    throw e;
  }
}
function chunkReader(client, servers, manifest, fileKey, cacheChunks) {
  const { n, levels, lower } = layoutOf(manifest.size, ENCRYPTED_CHUNK);
  const lastLen = manifest.size - (n - 1) * ENCRYPTED_CHUNK;
  const hashesIn = (b) => Array.from({ length: b.length / 32 }, (_, i) => hex(b.subarray(i * 32, i * 32 + 32)));
  let top = null;
  const lowerCache = /* @__PURE__ */ new Map(), recent = /* @__PURE__ */ new Map();
  async function chunkHash(i) {
    top ??= hashesIn(openIndex(await readObject(client, servers, manifest.index), 0, 0, levels === 1 ? n : lower, fileKey));
    if (levels === 1) return top[i];
    const j = Math.floor(i / FANOUT);
    if (!lowerCache.has(j)) lowerCache.set(j, hashesIn(openIndex(await readObject(client, servers, top[j]), 1, j, Math.min(FANOUT, n - j * FANOUT), fileKey)));
    return lowerCache.get(j)[i - j * FANOUT];
  }
  async function chunk(i) {
    if (recent.has(i)) {
      const pt2 = recent.get(i);
      recent.delete(i);
      recent.set(i, pt2);
      return pt2;
    }
    const pt = openChunk(await readObject(client, servers, await chunkHash(i)), i, i === n - 1, fileKey, lastLen);
    if (cacheChunks > 0) {
      recent.set(i, pt);
      if (recent.size > cacheChunks) recent.delete(recent.keys().next().value);
    }
    return pt;
  }
  return async function read(start, stop) {
    if (!(Number.isSafeInteger(start) && Number.isSafeInteger(stop) && start >= 0 && stop <= manifest.size && start < stop)) fail2("bad-range", "\u8BFB\u53D6\u7684\u8303\u56F4\u4E0D\u5BF9");
    const first = Math.floor(start / ENCRYPTED_CHUNK), last = Math.floor((stop - 1) / ENCRYPTED_CHUNK);
    const out = new Uint8Array(stop - start);
    let o = 0;
    for (let i = first; i <= last; i++) {
      const pt = await chunk(i);
      const part = pt.subarray(i === first ? start - i * ENCRYPTED_CHUNK : 0, i === last ? stop - i * ENCRYPTED_CHUNK : pt.length);
      out.set(part, o);
      o += part.length;
    }
    if (start === 0 && stop === manifest.size && manifest.sha256 && sha256Hex(out) !== manifest.sha256) fail2("file-hash-mismatch", "\u6574\u4E2A\u6587\u4EF6\u7684 SHA-256 \u4E0E\u6E05\u5355\u4E0D\u7B26\uFF08Files \xA75.7 \u7B2C 7 \u6B65\uFF09");
    return out;
  };
}
async function openEncryptedFileWithKey(client, servers, envelopeSha, fileKey, { cacheChunks = 4 } = {}) {
  if (!(fileKey instanceof Uint8Array) || fileKey.length !== 32) fail2("bad-key", "\u6587\u4EF6\u94A5\u5319\u8981\u662F 32 \u5B57\u8282");
  const key = Uint8Array.from(fileKey);
  try {
    const { manifest } = openEnvelopeWithKey(await readObject(client, servers, envelopeSha), key);
    const read = chunkReader(client, servers, manifest, key, cacheChunks);
    let closed = false;
    return {
      manifest,
      read(start = 0, end = manifest.size) {
        if (closed) fail2("closed", "\u5DF2\u7ECF\u5173\u6389\u4E86");
        return read(start, end);
      },
      close() {
        closed = true;
        key.fill(0);
      }
    };
  } catch (e) {
    key.fill(0);
    throw e;
  }
}
async function readEncryptedFileWithKey(client, servers, envelopeSha, fileKey, { start = 0, end } = {}) {
  const f = await openEncryptedFileWithKey(client, servers, envelopeSha, fileKey, { cacheChunks: 0 });
  try {
    return { bytes: await f.read(start, end ?? f.manifest.size), manifest: f.manifest };
  } finally {
    f.close();
  }
}

// vendor/taperelay-client/src/devkey.mjs
var DAY = 86400;
var MAX_DAYS = DEV_KEY_MAX_SECONDS / DAY;
var DEVELOPER_KEY_REFUSED_MESSAGE = "\u8282\u70B9\u4E0D\u8BA4\u8FD9\u628A\u5F00\u53D1\u8005\u5BC6\u94A5\uFF08\u8FC7\u671F\u3001\u88AB\u540A\u9500\uFF0C\u6216\u4E0D\u662F\u7ED9\u8FD9\u53F0\u8282\u70B9\u7684\uFF09";
var SESSION_REFUSED_MESSAGE = "\u8282\u70B9\u4E0D\u8BA4\u8FD9\u4EFD\u4F1A\u8BDD\u6388\u6743\uFF08\u8FC7\u671F\u3001\u88AB\u64A4\u9500\uFF0C\u6216\u4E0D\u662F\u7ED9\u8FD9\u53F0\u8282\u70B9\u7684\uFF09";
var SCOPE_TEXT = Object.freeze({ objects: "\u5B58\u6587\u4EF6\u3001\u8BFB\u6587\u4EF6", release: "\u5220\u9664\u6587\u4EF6", send: "\u53D1\u6D88\u606F", inbox: "\u6536\u6D88\u606F", pointers: "\u6307\u9488", admit: "\u51C6\u5165" });
function refusedMessage(auth, scope = null) {
  if (!auth?.delegationHeader) return null;
  const dev = delegationType(auth.delegation?.delegation) === "DeveloperKey";
  if (scope && Array.isArray(auth.scopes) && !auth.scopes.includes(scope)) {
    const label = SCOPE_TEXT[scope] ?? scope;
    const pair = scope === "send" || scope === "inbox" ? "\uFF08\u6536\u53D1\u7535\u8DEF\u6D88\u606F\u8981\u52FE\u300C\u53D1\u6D88\u606F\u300D\u300C\u6536\u6D88\u606F\u300D\u4E24\u9879\uFF09" : "";
    return dev ? `\u8FD9\u628A\u5F00\u53D1\u8005\u5BC6\u94A5\u6CA1\u6709\u300C${label}\u300D\u6743\u9650${pair}\uFF1A\u5230\u63A7\u5236\u53F0\u300C\u5BC6\u94A5\u300D\u53E6\u751F\u6210\u4E00\u628A\u52FE\u4E0A\u7684\uFF0C\u6362\u6389 TAPERELAY_KEY` : `\u8FD9\u4EFD\u4F1A\u8BDD\u6388\u6743\u6CA1\u6709\u300C${label}\u300D\u6743\u9650${pair}\uFF1A\u91CD\u65B0\u6388\u6743\u65F6\u8981\u52FE\u4E0A`;
  }
  return dev ? DEVELOPER_KEY_REFUSED_MESSAGE : SESSION_REFUSED_MESSAGE;
}

// vendor/taperelay-client/src/upload.mjs
var CLAIM_BATCH = 1e3;
var MAX_SERVERS = 8;
var NEED = 2;
var RETRY_MS = [5e3, 3e4, 12e4];
var TRANSIENT = /* @__PURE__ */ new Set(["unreachable", "rate-limited", "chain-unavailable", "internal"]);
var transient = (e) => TRANSIENT.has(e?.code) || e?.status >= 500;
var sleep = (ms, signal = null) => new Promise((ok) => {
  if (signal?.aborted) return ok();
  const done = () => {
    clearTimeout(t);
    signal?.removeEventListener("abort", done);
    ok();
  };
  const t = setTimeout(done, ms);
  signal?.addEventListener("abort", done, { once: true });
});
var FAILURE_TEXT = {
  unreachable: "\u8FDE\u4E0D\u4E0A",
  "rate-limited": "\u8BF7\u6C42\u592A\u9891\u7E41\uFF0C\u7B49\u4E00\u4F1A\u513F\u518D\u8BD5",
  "quota-exceeded": "\u7A7A\u95F4\u4E0D\u591F\uFF1A\u5230\u63A7\u5236\u53F0\u300C\u8282\u70B9\u300D\u9875\u4E70\u5957\u9910\uFF0C\u6216\u5220\u6389\u4E0D\u7528\u7684\u6587\u4EF6",
  "storage-full": "\u8282\u70B9\u7684\u786C\u76D8\u5FEB\u6EE1\u4E86\uFF0C\u6682\u65F6\u4E0D\u6536\u65B0\u7684\u4E0A\u4F20",
  "container-status": "\u7535\u8DEF\u7684\u5BB9\u5668\u73B0\u5728\u4E0D\u80FD\u5B58\u6587\u4EF6\uFF08\u8FD8\u6CA1\u5F00\u901A\uFF0C\u6216\u5DF2\u7ECF\u505C\u7528\uFF09",
  "operator-exiting": "\u8282\u70B9\u7684\u8FD0\u8425\u65B9\u5DF2\u58F0\u660E\u9000\u51FA\uFF0C\u4E0D\u518D\u6536\u65B0\u7684\u4E0A\u4F20",
  "chain-unavailable": "\u8282\u70B9\u6682\u65F6\u8BFB\u4E0D\u4E86\u94FE\uFF0C\u7B49\u4E00\u4F1A\u513F\u518D\u8BD5"
};
function failureText(x, auth) {
  if (x.code === "delegation-invalid") {
    const r = refusedMessage(auth, "objects");
    if (r) return r;
  }
  if ((x.code === "developer-key-expired" || x.code === "aborted") && x.message) return x.message;
  return FAILURE_TEXT[x.code] ?? x.code;
}
var errOf = (e) => ({ code: String(e?.code ?? "error").slice(0, 64), message: String(e?.message ?? e).slice(0, 200) });
var checkServers = (servers) => {
  if (!Array.isArray(servers) || servers.length < 1 || servers.length > MAX_SERVERS || new Set(servers).size !== servers.length) throw new Error(`servers \u8981\u6709 1\uFF5E${MAX_SERVERS} \u53F0\u3001\u4E0D\u5F97\u91CD\u590D`);
};
function checkAborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error("\u4E0A\u4F20\u505C\u4E0B\u4E86"), { code: "aborted" });
}
async function uploadFile(client, name, auth, input, { plan, fileName, contentType, onProgress, signal, claim = true } = {}) {
  const p = plan ?? await planPublicFile(input, { name: fileName, contentType });
  const extra = p.extraObjects ?? [];
  const objects = [...p.indexObjects.map((o) => o.sha256), ...p.chunkHashes, ...extra.map((o) => o.sha256)];
  const missing = /* @__PURE__ */ new Set();
  let claimed = 0;
  if (!claim) for (const sha of objects) missing.add(sha);
  for (let i = 0; claim && i < objects.length; i += CLAIM_BATCH) {
    checkAborted(signal);
    const batch = [...new Set(objects.slice(i, i + CLAIM_BATCH))];
    const r = await client.claim(name, auth, batch);
    claimed += r.claimed.length;
    for (const sha of r.missing) missing.add(sha);
  }
  let done = 0;
  const total = missing.size;
  for (const o of p.indexObjects) {
    if (!missing.has(o.sha256)) continue;
    checkAborted(signal);
    await client.upload(name, auth, o.bytes);
    missing.delete(o.sha256);
    done++;
    onProgress?.({ done, total });
  }
  for (let i = 0; i < p.chunkHashes.length && missing.size; i++) {
    const sha = p.chunkHashes[i];
    if (!missing.has(sha)) continue;
    checkAborted(signal);
    const bytes = p.chunkBytes ? await p.chunkBytes(i) : await p.source.read(i * CHUNK, Math.min(p.source.size, (i + 1) * CHUNK));
    const r = await client.upload(name, auth, bytes);
    if (r.sha256 !== sha) throw new Error(`\u7B2C ${i} \u5757\u5728\u4E0A\u4F20\u671F\u95F4\u53D8\u4E86`);
    missing.delete(sha);
    done++;
    onProgress?.({ done, total });
  }
  for (const o of extra) {
    if (!missing.has(o.sha256)) continue;
    checkAborted(signal);
    await client.upload(name, auth, o.bytes);
    missing.delete(o.sha256);
    done++;
    onProgress?.({ done, total });
  }
  return { manifest: p.manifest, manifestJson: p.manifestJson, fileId: p.fileId, uploaded: done, claimed, ...p.envelope ? { envelope: p.envelope.sha256 } : {} };
}
async function uploadToServers(client, servers, auth, input, { plan, fileName, contentType, onProgress, retryMs = RETRY_MS, retry = null, signal = null, claim = true } = {}) {
  checkServers(servers);
  const p = plan ?? await planPublicFile(input, { name: fileName, contentType });
  const need2 = Math.min(NEED, servers.length);
  const status = /* @__PURE__ */ new Map();
  const waiters = /* @__PURE__ */ new Set();
  const update = (server, v) => {
    status.set(server, v);
    for (const w of [...waiters]) w();
  };
  const again = retry ?? (async ({ attempt }) => {
    await sleep(retryMs[attempt], signal);
    return true;
  });
  const stopped = { code: "aborted", message: "\u4E0A\u4F20\u505C\u4E0B\u4E86" };
  const one = async (server) => {
    for (let i = 0; ; i++) {
      let err2;
      try {
        await uploadFile(client, server, auth, input, { plan: p, signal, claim, onProgress: onProgress && ((x) => onProgress({ server, ...x })) });
        return update(server, { ok: true });
      } catch (e) {
        err2 = e;
      }
      const final = !transient(err2) || !retry && i >= retryMs.length || !!signal?.aborted;
      update(server, { error: signal?.aborted ? stopped : errOf(err2), final });
      if (final) return;
      let go = false;
      try {
        go = await again({ server, attempt: i, error: errOf(err2) });
      } catch {
        go = false;
      }
      if (!go || signal?.aborted) return update(server, { error: signal?.aborted ? stopped : errOf(err2), final: true });
    }
  };
  const told = (x) => {
    if (!x.code) return x;
    const text = failureText(x, auth);
    return text === x.code || text === x.message ? x : { ...x, message: `${text}\uFF08${x.server}\uFF09` };
  };
  const snapshot = () => ({
    ok: servers.filter((s) => status.get(s)?.ok),
    failed: servers.filter((s) => status.get(s)?.final).map((s) => told({ server: s, ...status.get(s).error })),
    pending: servers.filter((s) => !status.get(s)?.ok && !status.get(s)?.final).map((s) => told({ server: s, ...status.get(s)?.error }))
  });
  const settled = Promise.all(servers.map(one)).then(snapshot);
  await new Promise((resolve) => {
    const check = () => {
      if (servers.filter((s) => status.get(s)?.ok).length >= need2 || servers.every((s) => status.has(s))) {
        waiters.delete(check);
        resolve();
      }
    };
    waiters.add(check);
    check();
  });
  const now = snapshot();
  const stored = now.ok.length >= need2;
  let message = null;
  if (!stored) {
    const groups = /* @__PURE__ */ new Map();
    for (const x of [...now.failed, ...now.pending.filter((y) => y.code)]) {
      const k = failureText(x, auth);
      groups.set(k, [...groups.get(k) ?? [], x.server]);
    }
    const why = [...groups].map(([reason, names]) => `${reason}\uFF1A${names.join("\u3001")}`).join("\uFF1B");
    message = `\u53EA\u5B58\u597D ${now.ok.length} \u53F0\uFF0C\u8981 ${need2} \u53F0${why ? `\uFF1B${why}` : ""}`;
  }
  return { stored, need: need2, ...now, message, settled, manifest: p.manifest, manifestJson: p.manifestJson, fileId: p.fileId, ...p.envelope ? { envelope: p.envelope.sha256 } : {} };
}

// vendor/taperelay-client/src/remote.mjs
var MAX_BATCH = 100;
var DELEGATION = /^[A-Za-z0-9_-]{1,16384}$/;
var err = (code, message) => Object.assign(new Error(message ?? code), { code });
function remoteAuth({ account, endpoint, headers = {}, fetch = globalThis.fetch, windowMs = 10 }) {
  if (typeof account === "string") account = normalizeCircuitInput(account) ?? account;
  let queue = [], timer = null;
  async function flush() {
    const batch = queue;
    queue = [];
    clearTimeout(timer);
    timer = null;
    let res, json;
    try {
      res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ requests: batch.map((b) => b.item) }) });
      json = await res.json().catch(() => null);
    } catch {
      for (const b of batch) b.no(err("unreachable", "\u8FDE\u4E0D\u4E0A\u7B7E\u540D\u7684\u540E\u53F0"));
      return;
    }
    if (!res.ok || !Array.isArray(json?.signatures) || json.signatures.length !== batch.length) {
      const e = err(typeof json?.error === "string" ? json.error.slice(0, 64) : `http-${res.status}`, typeof json?.message === "string" ? json.message.slice(0, 300) : "\u540E\u53F0\u6CA1\u6709\u7B7E");
      e.status = res.status;
      for (const b of batch) b.no(e);
      return;
    }
    if (json.delegation !== void 0 && !(typeof json.delegation === "string" && DELEGATION.test(json.delegation))) {
      for (const b of batch) b.no(err("bad-reply", "\u540E\u53F0\u7ED9\u7684\u6388\u6743\u58F0\u660E\u5199\u6CD5\u4E0D\u5BF9"));
      return;
    }
    auth.delegationHeader = json.delegation ?? null;
    batch.forEach((b, i) => {
      const sig = normalizeSignature(json.signatures[i]);
      if (sig) b.ok(sig);
      else b.no(err("bad-reply", "\u540E\u53F0\u7ED9\u7684\u7B7E\u540D\u5199\u6CD5\u4E0D\u5BF9"));
    });
  }
  const auth = {
    account,
    delegationHeader: null,
    sign(d, td, body) {
      return new Promise((ok, no) => {
        const item = { message: td.message };
        if (td.message.path === "/v1/objects/claim") item.body = new TextDecoder().decode(body);
        queue.push({ item, ok, no });
        if (queue.length >= MAX_BATCH) flush();
        else timer ??= setTimeout(flush, windowMs);
      });
    }
  };
  return auth;
}

// vendor/taperelay-client/src/isobmff.mjs
var MAX_SAMPLES = 2e7;
var bad = (message) => {
  throw Object.assign(new Error(message), { code: "bad-media" });
};
var u323 = (b, p) => (b[p] << 24 >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
var i32 = (b, p) => u323(b, p) | 0;
var u64 = (b, p) => u323(b, p) * 2 ** 32 + u323(b, p + 4);
var i64 = (b, p) => Number(BigInt.asIntN(64, BigInt(u323(b, p)) << 32n | BigInt(u323(b, p + 4))));
var fourcc = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
function boxAt(b, p, end = b.length) {
  if (p + 8 > end || p + 8 > b.length) return null;
  let size = u323(b, p), hdr = 8;
  const type = fourcc(b, p + 4);
  if (size === 1) {
    if (p + 16 > end || p + 16 > b.length) return null;
    size = u64(b, p + 8);
    hdr = 16;
  } else if (size === 0) size = end - p;
  if (size < hdr) return null;
  return { type, start: p, size, hdr, body: p + hdr, end: p + size };
}
function children(b, start, end) {
  const out = [];
  for (let p = start; p + 8 <= end; ) {
    const x = boxAt(b, p, end);
    if (!x || x.end > end) break;
    out.push(x);
    p = x.end;
  }
  return out;
}
var child = (b, box2, type) => box2 ? children(b, box2.body, box2.end).find((c) => c.type === type) ?? null : null;
var need = (x, what) => x ?? bad(`MP4 \u91CC\u5C11\u4E86 ${what}`);
var hex2 = (n) => n.toString(16).padStart(2, "0");
var HEX2 = (n) => n.toString(16).padStart(2, "0").toUpperCase();
function descriptors(b, p, end) {
  const out = [];
  while (p + 2 <= end) {
    const tag = b[p++];
    let len = 0, k = 0;
    do {
      len = len << 7 | b[p] & 127;
    } while (b[p++] & 128 && ++k < 4);
    if (p + len > end) break;
    out.push({ tag, start: p, end: p + len });
    p += len;
  }
  return out;
}
function mp4aString(b, entry) {
  const qtVersion = b[entry.body + 8] << 8 | b[entry.body + 9];
  const kidsAt = entry.body + 28 + (qtVersion === 1 ? 16 : qtVersion === 2 ? 36 : 0);
  const esds = children(b, kidsAt, entry.end).find((c) => c.type === "esds");
  const es = esds ? descriptors(b, esds.body + 4, esds.end).find((d) => d.tag === 3) : null;
  if (!es || es.end - es.start < 3) return "mp4a.40.2";
  const flags = b[es.start + 2];
  let q = es.start + 3;
  if (flags & 128) q += 2;
  if (flags & 64) q += 1 + b[q];
  if (flags & 32) q += 2;
  const dc = descriptors(b, q, es.end).find((d) => d.tag === 4);
  if (!dc || dc.end - dc.start < 13) return "mp4a.40.2";
  const oti = b[dc.start];
  if (oti !== 64) return `mp4a.${HEX2(oti)}`;
  const dsi = descriptors(b, dc.start + 13, dc.end).find((d) => d.tag === 5);
  let aot = dsi ? b[dsi.start] >> 3 : 2;
  if (dsi && aot === 31) aot = 32 + ((b[dsi.start] & 7) << 3 | b[dsi.start + 1] >> 5);
  return `mp4a.40.${aot}`;
}
function hevcString(b, cfg, type) {
  const p = cfg.body, b1 = b[p + 1];
  const space = ["", "A", "B", "C"][b1 >> 6], tier = b1 >> 5 & 1 ? "H" : "L", profile = b1 & 31;
  let compat = u323(b, p + 2), rev = 0;
  for (let i = 0; i < 32; i++) {
    rev = rev << 1 | compat & 1;
    compat >>>= 1;
  }
  const cons = Array.from(b.subarray(p + 6, p + 12));
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  return [type, `${space}${profile}`, (rev >>> 0).toString(16).toUpperCase(), `${tier}${b[p + 12]}`, ...cons.map((x) => x.toString(16).toUpperCase())].join(".");
}
function av1String(b, cfg) {
  const p = cfg.body;
  const profile = b[p + 1] >> 5, level = b[p + 1] & 31, tier = b[p + 2] >> 7 ? "H" : "M";
  const high = b[p + 2] >> 6 & 1, twelve = b[p + 2] >> 5 & 1;
  return `av01.${profile}.${String(level).padStart(2, "0")}${tier}.${high ? twelve ? "12" : "10" : "08"}`;
}
function codecOf(b, entry) {
  const t = entry.type;
  const vkids = () => children(b, entry.body + 78, entry.end);
  if (t === "avc1" || t === "avc3") {
    const c = vkids().find((x) => x.type === "avcC");
    return c && c.end - c.body >= 4 ? `${t}.${hex2(b[c.body + 1])}${hex2(b[c.body + 2])}${hex2(b[c.body + 3])}` : t;
  }
  if (t === "hvc1" || t === "hev1") {
    const c = vkids().find((x) => x.type === "hvcC");
    return c && c.end - c.body >= 13 ? hevcString(b, c, t) : t;
  }
  if (t === "vp09") {
    const c = vkids().find((x) => x.type === "vpcC");
    return c && c.end - c.body >= 7 ? `vp09.${String(b[c.body + 4]).padStart(2, "0")}.${String(b[c.body + 5]).padStart(2, "0")}.${String(b[c.body + 6] >> 4).padStart(2, "0")}` : "vp09.00.10.08";
  }
  if (t === "av01") {
    const c = vkids().find((x) => x.type === "av1C");
    return c && c.end - c.body >= 3 ? av1String(b, c) : "av01.0.04M.08";
  }
  if (t === "mp4a") return mp4aString(b, entry);
  if (t === "Opus") return "opus";
  if (t === "fLaC") return "flac";
  if (t === "ac-3" || t === "ec-3") return t;
  return t;
}
function parseTrak(b, trak) {
  const tkhd = need(child(b, trak, "tkhd"), "tkhd"), mdia = need(child(b, trak, "mdia"), "mdia");
  const mdhd = need(child(b, mdia, "mdhd"), "mdhd"), hdlr = need(child(b, mdia, "hdlr"), "hdlr"), minf = need(child(b, mdia, "minf"), "minf");
  const handler = fourcc(b, hdlr.body + 8);
  if (handler !== "vide" && handler !== "soun") return null;
  const stbl = need(child(b, minf, "stbl"), "stbl"), stsd = need(child(b, stbl, "stsd"), "stsd");
  const id2 = b[tkhd.body] ? u323(b, tkhd.body + 20) : u323(b, tkhd.body + 12);
  const timescale = b[mdhd.body] ? u323(b, mdhd.body + 20) : u323(b, mdhd.body + 12);
  if (!timescale) bad("\u8F68\u7684\u65F6\u95F4\u5355\u4F4D\u662F 0");
  const entries = u323(b, stsd.body + 4);
  const entry = boxAt(b, stsd.body + 8, stsd.end) ?? bad("\u6837\u672C\u63CF\u8FF0\u5199\u574F\u4E86");
  const edts = child(b, trak, "edts"), elst = child(b, edts, "elst");
  const edits = [];
  if (elst) {
    const v = b[elst.body], n = Math.min(u323(b, elst.body + 4), Math.floor((elst.end - elst.body - 8) / (v ? 20 : 12)));
    for (let i = 0, p = elst.body + 8; i < n; i++, p += v ? 20 : 12) edits.push(v ? { dur: u64(b, p), mediaTime: i64(b, p + 8) } : { dur: u323(b, p), mediaTime: i32(b, p + 4) });
  }
  const stsz = child(b, stbl, "stsz"), stz2 = child(b, stbl, "stz2");
  let count = 0, sizes;
  if (stsz) {
    const fixed = u323(b, stsz.body + 4);
    count = u323(b, stsz.body + 8);
    if (count > MAX_SAMPLES || !fixed && stsz.body + 12 + 4 * count > stsz.end) bad("\u6837\u672C\u5927\u5C0F\u8868\u5199\u574F\u4E86");
    sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || u323(b, stsz.body + 12 + 4 * i);
  } else if (stz2) {
    const field = b[stz2.body + 7];
    count = u323(b, stz2.body + 8);
    if (![4, 8, 16].includes(field) || count > MAX_SAMPLES || stz2.body + 12 + Math.ceil(count * field / 8) > stz2.end) bad("\u6837\u672C\u5927\u5C0F\u8868\uFF08stz2\uFF09\u5199\u574F\u4E86");
    sizes = new Uint32Array(count);
    for (let i = 0, p = stz2.body + 12; i < count; i++) {
      sizes[i] = field === 16 ? b[p + 2 * i] << 8 | b[p + 2 * i + 1] : field === 8 ? b[p + i] : b[p + (i >> 1)] >> (i & 1 ? 0 : 4) & 15;
    }
  } else sizes = new Uint32Array(0);
  const dts = new Float64Array(count), dur = new Uint32Array(count), cto = new Int32Array(count), sync = new Uint8Array(count), off = new Float64Array(count);
  const stts = child(b, stbl, "stts");
  if (stts) {
    const n = Math.min(u323(b, stts.body + 4), Math.floor((stts.end - stts.body - 8) / 8));
    let s = 0, t = 0;
    for (let e = 0; e < n && s < count; e++) {
      const c = u323(b, stts.body + 8 + 8 * e), d = u323(b, stts.body + 12 + 8 * e);
      for (let k = 0; k < c && s < count; k++, s++) {
        dts[s] = t;
        dur[s] = d;
        t += d;
      }
    }
    if (s < count) bad("\u6837\u672C\u65F6\u95F4\u8868\u6BD4\u6837\u672C\u5C11");
  } else if (count) bad("\u6CA1\u6709\u6837\u672C\u65F6\u95F4\u8868");
  const ctts = child(b, stbl, "ctts");
  if (ctts) {
    const n = Math.min(u323(b, ctts.body + 4), Math.floor((ctts.end - ctts.body - 8) / 8));
    const signed = b[ctts.body] === 1;
    let s = 0;
    for (let e = 0; e < n && s < count; e++) {
      const c = u323(b, ctts.body + 8 + 8 * e), o = signed ? i32(b, ctts.body + 12 + 8 * e) : u323(b, ctts.body + 12 + 8 * e) | 0;
      for (let k = 0; k < c && s < count; k++) cto[s++] = o;
    }
  }
  const stss = child(b, stbl, "stss");
  if (stss) {
    const n = Math.min(u323(b, stss.body + 4), Math.floor((stss.end - stss.body - 8) / 4));
    for (let e = 0; e < n; e++) {
      const k = u323(b, stss.body + 8 + 4 * e) - 1;
      if (k >= 0 && k < count) sync[k] = 1;
    }
  } else sync.fill(1);
  const stco = child(b, stbl, "stco"), co64 = child(b, stbl, "co64"), stsc = child(b, stbl, "stsc");
  if (count) {
    if (!stsc || !(stco || co64)) bad("\u6CA1\u6709\u6837\u672C\u5728\u6587\u4EF6\u91CC\u7684\u4F4D\u7F6E");
    const co = stco ?? co64, wide = !stco;
    const nChunks = Math.min(u323(b, co.body + 4), Math.floor((co.end - co.body - 8) / (wide ? 8 : 4)));
    const chunkOff = (c) => wide ? u64(b, co.body + 8 + 8 * c) : u323(b, co.body + 8 + 4 * c);
    const nRuns = Math.min(u323(b, stsc.body + 4), Math.floor((stsc.end - stsc.body - 8) / 12));
    const runs = Array.from({ length: nRuns }, (_, e) => ({ first: u323(b, stsc.body + 8 + 12 * e) - 1, per: u323(b, stsc.body + 12 + 12 * e) }));
    let s = 0;
    for (let r = 0; r < runs.length && s < count; r++) {
      const last = r + 1 < runs.length ? Math.min(runs[r + 1].first, nChunks) : nChunks;
      for (let c = Math.max(0, runs[r].first); c < last && s < count; c++) {
        let p = chunkOff(c);
        for (let k = 0; k < runs[r].per && s < count; k++, s++) {
          off[s] = p;
          p += sizes[s];
        }
      }
    }
    if (s < count) bad("\u6837\u672C\u4F4D\u7F6E\u8868\u6BD4\u6837\u672C\u5C11");
  }
  return {
    id: id2,
    timescale,
    handler,
    codec: codecOf(b, entry),
    entryType: entry.type,
    entries,
    edits,
    hasCtts: !!ctts,
    raw: { tkhd, edts, mdhd, hdlr, xmhd: children(b, minf.body, minf.end).find((c) => /^(vmhd|smhd|sthd|nmhd)$/.test(c.type)) ?? null, dinf: child(b, minf, "dinf"), stsd },
    count,
    sizes,
    dts,
    dur,
    cto,
    sync,
    off
  };
}
function parseMoov(bytes) {
  const b = bytes;
  const moov = boxAt(b, 0);
  if (!moov || moov.type !== "moov" || moov.end > b.length) bad("\u4E0D\u662F moov");
  const mvhd = need(child(b, moov, "mvhd"), "mvhd");
  const v1 = b[mvhd.body];
  const timescale = v1 ? u323(b, mvhd.body + 20) : u323(b, mvhd.body + 12);
  const duration = v1 ? u64(b, mvhd.body + 24) : u323(b, mvhd.body + 16);
  const mvex = child(b, moov, "mvex"), mehd = child(b, mvex, "mehd");
  const fragDuration = mehd ? b[mehd.body] ? u64(b, mehd.body + 4) : u323(b, mehd.body + 4) : 0;
  const all = children(b, moov.body, moov.end).filter((x) => x.type === "trak").map((t) => parseTrak(b, t)).filter(Boolean);
  const tracks = [all.find((t) => t.handler === "vide"), all.find((t) => t.handler === "soun")].filter(Boolean);
  if (!tracks.length) bad("MP4 \u91CC\u6CA1\u6709\u89C6\u9891\u3001\u97F3\u9891\u8F68");
  let seconds = timescale ? (duration || fragDuration) / timescale : 0;
  if (!seconds && !mvex) {
    for (const t of tracks) if (t.count) seconds = Math.max(seconds, (t.dts[t.count - 1] + t.dur[t.count - 1]) / t.timescale);
  }
  return { b, moov, mvhd, timescale, duration: seconds, fragmented: !!mvex, tracks };
}
function mimeOf(movie) {
  if (movie.tracks.some((t) => t.entries !== 1 || t.entryType === "encv" || t.entryType === "enca")) return null;
  const v = movie.tracks.some((t) => t.handler === "vide");
  return `${v ? "video" : "audio"}/mp4; codecs="${movie.tracks.map((t) => t.codec).join(",")}"`;
}
var enc4 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
var be32 = (n) => Uint8Array.of(n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255);
var be64 = (n) => {
  const hi = Math.floor(n / 2 ** 32);
  return Uint8Array.of(...be32(hi), ...be32(n >>> 0));
};
function concat3(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function box(type, ...parts) {
  const body = concat3(parts.filter(Boolean));
  return concat3([be32(8 + body.length), enc4(type), body]);
}
var full = (type, version, flags, ...parts) => box(type, Uint8Array.of(version, flags >>> 16 & 255, flags >>> 8 & 255, flags & 255), ...parts);
var raw = (b, x) => x ? b.subarray(x.start, x.end) : null;
function mp4Stsd(b, stsd, handler) {
  if (!stsd || u323(b, stsd.body + 4) !== 1) return raw(b, stsd);
  const e = boxAt(b, stsd.body + 8, stsd.end);
  if (!e || e.end > stsd.end) return raw(b, stsd);
  let head, from;
  if (handler === "vide") {
    if (e.size < e.hdr + 78) return raw(b, stsd);
    head = b.subarray(e.body, e.body + 78);
    from = e.body + 78;
  } else if (handler === "soun") {
    if (e.size < e.hdr + 28) return raw(b, stsd);
    const ver = b[e.body + 8] << 8 | b[e.body + 9];
    if (ver === 2 || ver === 1 && e.size < e.hdr + 44) return raw(b, stsd);
    head = Uint8Array.from(b.subarray(e.body, e.body + 28));
    head[8] = 0;
    head[9] = 0;
    from = e.body + (ver === 1 ? 44 : 28);
  } else return raw(b, stsd);
  const kids2 = children(b, from, e.end).flatMap((c) => {
    if (c.type !== "wave") return [raw(b, c)];
    const esds = children(b, c.body, c.end).find((x) => x.type === "esds");
    return esds ? [raw(b, esds)] : [];
  });
  return full("stsd", 0, 0, be32(1), box(e.type, head, ...kids2));
}
function buildInit(movie) {
  const { b } = movie;
  const empty = (t) => full(t, 0, 0, be32(0));
  const traks = movie.tracks.map((t) => box(
    "trak",
    raw(b, t.raw.tkhd),
    raw(b, t.raw.edts),
    box(
      "mdia",
      raw(b, t.raw.mdhd),
      raw(b, t.raw.hdlr),
      box(
        "minf",
        raw(b, t.raw.xmhd),
        raw(b, t.raw.dinf),
        box("stbl", mp4Stsd(b, t.raw.stsd, t.handler), empty("stts"), empty("stsc"), full("stsz", 0, 0, be32(0), be32(0)), empty("stco"))
      )
    )
  ));
  const mvex = box(
    "mvex",
    full("mehd", 1, 0, be64(Math.round(movie.duration * movie.timescale))),
    ...movie.tracks.map((t) => full("trex", 0, 0, be32(t.id), be32(1), be32(0), be32(0), be32(0)))
  );
  return concat3([box("ftyp", enc4("iso6"), be32(0), enc4("iso6"), enc4("iso5"), enc4("mp41")), box("moov", raw(b, movie.mvhd), ...traks, mvex)]);
}
var lowerBound = (arr, n, x) => {
  let lo = 0, hi = n;
  while (lo < hi) {
    const m = lo + hi >> 1;
    if (arr[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
};
function planFragments(movie, target = 2) {
  const lead = movie.tracks.find((t) => t.handler === "vide") ?? movie.tracks[0];
  if (!lead.count) bad("\u8F68\u91CC\u6CA1\u6709\u6837\u672C");
  const starts = [0];
  for (let i = 1, t0 = 0; i < lead.count; i++) {
    if (lead.sync[i] && (lead.dts[i] - lead.dts[t0]) / lead.timescale >= target) {
      starts.push(i);
      t0 = i;
    }
  }
  const times = starts.map((i) => lead.dts[i] / lead.timescale);
  return times.map((t0, k) => {
    const t1 = k + 1 < times.length ? times[k + 1] : Infinity;
    return {
      t0,
      t1,
      parts: movie.tracks.map((t) => t === lead ? { track: t, first: starts[k], last: k + 1 < starts.length ? starts[k + 1] : t.count } : { track: t, first: k === 0 ? 0 : lowerBound(t.dts, t.count, t0 * t.timescale), last: t1 === Infinity ? t.count : lowerBound(t.dts, t.count, t1 * t.timescale) })
    };
  });
}
function fragmentAt(frags, t) {
  let lo = 0, hi = frags.length - 1;
  while (lo < hi) {
    const m = lo + hi + 1 >> 1;
    if (frags[m].t0 <= t) lo = m;
    else hi = m - 1;
  }
  return lo;
}
async function buildFragment(frag, seq, read) {
  const spans = [];
  for (const p of frag.parts) for (let i = p.first; i < p.last; i++) spans.push([p.track.off[i], p.track.off[i] + p.track.sizes[i]]);
  spans.sort((x, y) => x[0] - y[0]);
  const runs = [];
  for (const s of spans) {
    const r = runs[runs.length - 1];
    if (r && s[0] - r[1] < 65536) r[1] = Math.max(r[1], s[1]);
    else runs.push([s[0], s[1]]);
  }
  const got = await Promise.all(runs.map(([a, b]) => read(a, b)));
  const bytesAt2 = (o2, n) => {
    let lo = 0, hi = runs.length - 1;
    while (lo < hi) {
      const m = lo + hi + 1 >> 1;
      if (runs[m][0] <= o2) lo = m;
      else hi = m - 1;
    }
    if (!(o2 >= runs[lo][0] && o2 + n <= runs[lo][1])) bad("\u6837\u672C\u4E0D\u5728\u8BFB\u5230\u7684\u5B57\u8282\u91CC");
    return got[lo].subarray(o2 - runs[lo][0], o2 - runs[lo][0] + n);
  };
  const lens = frag.parts.map((p) => {
    let n = 0;
    for (let i = p.first; i < p.last; i++) n += p.track.sizes[i];
    return n;
  });
  const total = lens.reduce((a, n) => a + n, 0);
  const moofWith = (offsets2) => box("moof", full("mfhd", 0, 0, be32(seq)), ...frag.parts.map((p, k) => {
    const t = p.track, n = p.last - p.first, rows = new Uint8Array(16 * n);
    for (let i = 0; i < n; i++) {
      const s = p.first + i, o2 = 16 * i;
      rows.set(be32(t.dur[s]), o2);
      rows.set(be32(t.sizes[s]), o2 + 4);
      rows.set(be32(t.sync[s] ? 33554432 : 16842752), o2 + 8);
      rows.set(be32(t.cto[s] >>> 0), o2 + 12);
    }
    return box("traf", full("tfhd", 0, 131072, be32(t.id)), full("tfdt", 1, 0, be64(n ? t.dts[p.first] : 0)), full("trun", 1, 3841, be32(n), be32(offsets2[k] >>> 0), rows));
  }));
  const moofSize = moofWith(frag.parts.map(() => 0)).length;
  let o = moofSize + 8;
  const offsets = lens.map((n) => {
    const x = o;
    o += n;
    return x;
  });
  const out = new Uint8Array(moofSize + 8 + total);
  out.set(moofWith(offsets), 0);
  out.set(be32(8 + total), moofSize);
  out.set(enc4("mdat"), moofSize + 4);
  let w = moofSize + 8;
  for (const p of frag.parts) for (let i = p.first; i < p.last; i++) {
    out.set(bytesAt2(p.track.off[i], p.track.sizes[i]), w);
    w += p.track.sizes[i];
  }
  return out;
}
function parseSidx(b, at, fileAt) {
  const x = boxAt(b, at);
  if (!x || x.type !== "sidx" || x.end > b.length) return null;
  const v = b[x.body];
  const timescale = u323(b, x.body + 8);
  let p = x.body + 12;
  if (!timescale) return null;
  let time = v ? u64(b, p) : u323(b, p);
  let offset = fileAt + x.size + (v ? u64(b, p + 8) : u323(b, p + 4));
  p += v ? 16 : 8;
  const count = b[p + 2] << 8 | b[p + 3];
  p += 4;
  if (p + 12 * count > x.end) return null;
  const out = [];
  for (let i = 0; i < count; i++, p += 12) {
    const ref = u323(b, p), size = ref & 2147483647, d = u323(b, p + 4);
    if (ref >>> 31) return null;
    out.push({ time: time / timescale, offset });
    time += d;
    offset += size;
  }
  return out.length ? out : null;
}
function parseMfra(b, trackId, timescale) {
  const x = boxAt(b, 0);
  if (!x || x.type !== "mfra" || x.end > b.length) return null;
  for (const t of children(b, x.body, x.end).filter((c) => c.type === "tfra")) {
    if (u323(b, t.body + 4) !== trackId) continue;
    const v = b[t.body], lens = u323(b, t.body + 8), n = u323(b, t.body + 12);
    const extra = (lens >> 4 & 3) + 1 + (lens >> 2 & 3) + 1 + (lens & 3) + 1;
    const row = (v ? 16 : 8) + extra;
    if (t.body + 16 + row * n > t.end) return null;
    const out = [];
    for (let i = 0, p = t.body + 16; i < n; i++, p += row) out.push({ time: (v ? u64(b, p) : u323(b, p)) / timescale, offset: v ? u64(b, p + 8) : u323(b, p + 4) });
    return out.length ? out : null;
  }
  return null;
}
function moofIn(w, base, trackId) {
  for (let i = 4; i + 12 <= w.length; i++) {
    if (w[i] !== 109 || w[i + 1] !== 111 || w[i + 2] !== 111 || w[i + 3] !== 102) continue;
    if (fourcc(w, i + 8) !== "mfhd") continue;
    const moof = boxAt(w, i - 4, Infinity);
    if (!moof) continue;
    const end = Math.min(moof.end, w.length);
    for (const traf of children(w, moof.body, end).filter((c) => c.type === "traf")) {
      const tfhd = child(w, traf, "tfhd"), tfdt = child(w, traf, "tfdt");
      if (!tfhd || !tfdt || u323(w, tfhd.body + 4) !== trackId) continue;
      return { start: base + i - 4, time: w[tfdt.body] ? u64(w, tfdt.body + 4) : u323(w, tfdt.body + 4) };
    }
  }
  return null;
}
function lastMoofEnd(w, base, track) {
  let last = null;
  for (let i = 0; ; ) {
    const m = moofIn(w.subarray(i), base + i, track.id);
    if (!m) break;
    last = m;
    i = m.start - base + 8;
  }
  if (!last) return null;
  const b = w.subarray(last.start - base), moof = boxAt(b, 0, Infinity);
  let sum = 0;
  for (const traf of children(b, moof.body, Math.min(moof.end, b.length)).filter((c) => c.type === "traf")) {
    const tfhd = child(b, traf, "tfhd"), trun = child(b, traf, "trun");
    if (!tfhd || !trun || u323(b, tfhd.body + 4) !== track.id) continue;
    const tflags = b[tfhd.body + 1] << 16 | b[tfhd.body + 2] << 8 | b[tfhd.body + 3];
    let q = tfhd.body + 8 + (tflags & 1 ? 8 : 0) + (tflags & 2 ? 4 : 0);
    const defDur = tflags & 8 ? u323(b, q) : 0;
    const flags = b[trun.body + 1] << 16 | b[trun.body + 2] << 8 | b[trun.body + 3], cnt = u323(b, trun.body + 4);
    let r = trun.body + 8 + (flags & 1 ? 4 : 0) + (flags & 4 ? 4 : 0);
    const per = [256, 512, 1024, 2048].filter((f) => flags & f).length * 4;
    if (r + per * cnt > trun.end) continue;
    if (flags & 256) for (let k = 0; k < cnt; k++, r += per) sum += u323(b, r);
    else sum += defDur * cnt;
  }
  return (last.time + sum) / track.timescale;
}

// vendor/taperelay-client/src/faststart.mjs
var MAX_TOP_BOXES = 4096;
var MAX_MOOV = 64 * 1048576;
var CONTAINERS = /* @__PURE__ */ new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "udta"]);
var isBlob = (x) => typeof Blob !== "undefined" && x instanceof Blob;
var sizeOf = (x) => isBlob(x) ? x.size : x.length;
async function bytesAt(x, a, b) {
  return isBlob(x) ? new Uint8Array(await x.slice(a, b).arrayBuffer()) : x.subarray(a, b);
}
async function topBoxes(x) {
  const total = sizeOf(x), out = [];
  for (let p = 0; p < total; ) {
    if (out.length >= MAX_TOP_BOXES || p + 8 > total) return null;
    const h = await bytesAt(x, p, Math.min(total, p + 16));
    const b = boxAt(h, 0, total - p);
    if (!b || p + b.size > total) return null;
    out.push({ type: b.type, start: p, size: b.size });
    p += b.size;
  }
  return out;
}
function patchMoov(m, from, to, shift) {
  let ok = true;
  const walk = (start, end) => {
    for (const c of children(m, start, end)) {
      if (!ok) return;
      if (c.type === "cmov" || c.type === "iloc" || c.type === "saio" || c.type === "mvex") {
        ok = false;
        return;
      }
      if (c.type === "stco" || c.type === "co64") {
        const n = u323(m, c.body + 4), wide = c.type === "co64";
        if (c.body + 8 + n * (wide ? 8 : 4) > c.end) {
          ok = false;
          return;
        }
        for (let i = 0; i < n; i++) {
          const p = c.body + 8 + i * (wide ? 8 : 4);
          const v = wide ? u64(m, p) : u323(m, p);
          if (v < from || v >= to) continue;
          const nv = v + shift;
          if (!wide && nv > 4294967295) {
            ok = false;
            return;
          }
          if (wide) {
            const hi = Math.floor(nv / 2 ** 32), lo = nv % 2 ** 32;
            new DataView(m.buffer, m.byteOffset).setUint32(p, hi);
            new DataView(m.buffer, m.byteOffset).setUint32(p + 4, lo);
          } else new DataView(m.buffer, m.byteOffset).setUint32(p, nv);
        }
      } else if (CONTAINERS.has(c.type)) walk(c.body, c.end);
      else if (c.type === "meta") {
        if ([c.body, c.body + 4].some((s) => children(m, s, c.end).some((x) => x.type === "iloc"))) {
          ok = false;
          return;
        }
      }
    }
  };
  const top = boxAt(m, 0);
  if (!top || top.type !== "moov") return false;
  walk(top.body, top.end);
  return ok;
}
async function faststart(input) {
  const same = { data: input, moved: false };
  try {
    const boxes = await topBoxes(input);
    if (!boxes) return same;
    if (boxes.some((b) => b.type === "moof")) return same;
    const mi = boxes.findIndex((b) => b.type === "moov"), di = boxes.findIndex((b) => b.type === "mdat");
    if (mi < 0 || di < 0 || mi < di || boxes.filter((b) => b.type === "moov").length !== 1) return same;
    const moov = boxes[mi];
    if (moov.size > MAX_MOOV) return same;
    const m = Uint8Array.from(await bytesAt(input, moov.start, moov.start + moov.size));
    if (!patchMoov(m, boxes[di].start, moov.start, moov.size)) return same;
    const before = boxes.slice(0, di), middle = boxes.slice(di, mi), after = boxes.slice(mi + 1);
    const range = (list) => list.length ? [list[0].start, list[list.length - 1].start + list[list.length - 1].size] : null;
    const parts = [];
    for (const r of [range(before), "moov", range(middle), range(after)]) {
      if (r === "moov") parts.push(m);
      else if (r) parts.push(isBlob(input) ? input.slice(r[0], r[1]) : input.subarray(r[0], r[1]));
    }
    if (isBlob(input)) return { data: new Blob(parts, { type: input.type }), moved: true };
    const out = new Uint8Array(input.length);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return { data: out, moved: true };
  } catch {
    return same;
  }
}

// vendor/taperelay-client/src/webmindex.mjs
var ID = {
  EBML: 440786851,
  Segment: 408125543,
  SeekHead: 290298740,
  Seek: 19899,
  SeekID: 21419,
  SeekPos: 21420,
  Info: 357149030,
  TimecodeScale: 2807729,
  Duration: 17545,
  Tracks: 374648427,
  TrackEntry: 174,
  CodecID: 134,
  Cluster: 524531317,
  Timecode: 231,
  SimpleBlock: 163,
  BlockGroup: 160,
  Block: 161,
  Cues: 475249515,
  CuePoint: 187,
  CueTime: 179,
  CueTrackPositions: 183,
  CueClusterPosition: 241
};
var CODECS = { V_VP9: "vp9", V_VP8: "vp8", V_AV1: "av01.0.04M.08", A_OPUS: "opus", A_VORBIS: "vorbis" };
var bad2 = (message) => {
  throw Object.assign(new Error(message), { code: "bad-media" });
};
function vint(b, p) {
  const first = b[p];
  if (first === void 0 || first === 0) return null;
  let len = 1;
  while (!(first & 128 >> len - 1)) len++;
  if (p + len > b.length) return null;
  let v = first & 255 >> len;
  for (let i = 1; i < len; i++) v = v * 256 + b[p + i];
  return { v, len, unknown: v === 2 ** (7 * len) - 1 };
}
function id(b, p) {
  const first = b[p];
  if (first === void 0 || first < 16) return null;
  let len = 1;
  while (!(first & 128 >> len - 1)) len++;
  if (len > 4 || p + len > b.length) return null;
  let v = first;
  for (let i = 1; i < len; i++) v = v * 256 + b[p + i];
  return { v, len };
}
function el(b, p) {
  const i = id(b, p);
  if (!i) return null;
  const s = vint(b, p + i.len);
  if (!s) return null;
  const body = p + i.len + s.len;
  return { id: i.v, start: p, body, end: s.unknown ? Infinity : body + s.v, unknown: s.unknown };
}
var uint = (b, x) => {
  let v = 0;
  for (let p = x.body; p < x.end && p < x.body + 8; p++) v = v * 256 + b[p];
  return v;
};
var float = (b, x) => {
  const n = x.end - x.body;
  if (n !== 4 && n !== 8) return null;
  const dv = new DataView(b.buffer, b.byteOffset + x.body, n);
  return n === 4 ? dv.getFloat32(0) : dv.getFloat64(0);
};
function kids(b, start, end) {
  const out = [];
  for (let p = start; p < Math.min(end, b.length); ) {
    const x = el(b, p);
    if (!x || x.end > b.length) break;
    out.push(x);
    p = x.end;
  }
  return out;
}
function parseWebmHead(b) {
  const ebml = el(b, 0);
  if (!ebml || ebml.id !== ID.EBML) bad2("\u4E0D\u662F WebM");
  if (ebml.end > b.length) return { need: ebml.end + 64 };
  const seg = el(b, ebml.end);
  if (!seg) return { need: ebml.end + 64 };
  if (seg.id !== ID.Segment) bad2("WebM \u91CC\u6CA1\u6709 Segment");
  let scale = 1e6, duration = null, hasVideo = false, cuesAt = null;
  const codecs = [];
  for (let p = seg.body; ; ) {
    const x = el(b, p);
    if (!x) return { need: p + 64 };
    if (x.id === ID.Cluster) {
      const mime = codecs.length && codecs.every((c) => Object.values(CODECS).includes(c)) ? `${hasVideo ? "video" : "audio"}/webm; codecs="${codecs.join(",")}"` : null;
      return { initEnd: p, segmentBody: seg.body, mime, timecodeScale: scale, duration: duration === null ? null : duration * scale / 1e9, cuesAt };
    }
    if (x.unknown) bad2("WebM \u7684\u5934\u91CC\u6709\u4E0D\u77E5\u9053\u591A\u957F\u7684\u5143\u7D20");
    if (x.end > b.length) return { need: x.end + 64 };
    if (x.id === ID.Info) for (const k of kids(b, x.body, x.end)) {
      if (k.id === ID.TimecodeScale) scale = uint(b, k) || 1e6;
      if (k.id === ID.Duration) duration = float(b, k);
    }
    if (x.id === ID.Tracks) for (const t of kids(b, x.body, x.end).filter((k) => k.id === ID.TrackEntry)) {
      const c = kids(b, t.body, t.end).find((k) => k.id === ID.CodecID);
      const name = c ? new TextDecoder().decode(b.subarray(c.body, c.end)) : "";
      if (name.startsWith("V_")) hasVideo = true;
      codecs.push(CODECS[name] ?? name);
    }
    if (x.id === ID.SeekHead) for (const s of kids(b, x.body, x.end).filter((k) => k.id === ID.Seek)) {
      const ks = kids(b, s.body, s.end), sid = ks.find((k) => k.id === ID.SeekID), pos = ks.find((k) => k.id === ID.SeekPos);
      if (sid && pos && uint(b, sid) === ID.Cues) cuesAt = seg.body + uint(b, pos);
    }
    p = x.end;
  }
}
function cuesSize(b) {
  const x = el(b, 0);
  return x && x.id === ID.Cues && !x.unknown ? x.end : null;
}
function parseCues(b, segmentBody, scale = 1e6) {
  const x = el(b, 0);
  if (!x || x.id !== ID.Cues || x.end > b.length) return null;
  const out = [];
  for (const cp of kids(b, x.body, x.end).filter((k) => k.id === ID.CuePoint)) {
    const ks = kids(b, cp.body, cp.end), t = ks.find((k) => k.id === ID.CueTime), pos = ks.find((k) => k.id === ID.CueTrackPositions);
    const cl = pos ? kids(b, pos.body, pos.end).find((k) => k.id === ID.CueClusterPosition) : null;
    if (t && cl) out.push({ time: uint(b, t) * scale / 1e9, offset: segmentBody + uint(b, cl) });
  }
  out.sort((a, c) => a.time - c.time);
  return out.length ? out : null;
}
function clusterIn(w, base, scale = 1e6) {
  for (let i = 0; i + 8 < w.length; i++) {
    if (w[i] !== 31 || w[i + 1] !== 67 || w[i + 2] !== 182 || w[i + 3] !== 117) continue;
    const s = vint(w, i + 4);
    if (!s) continue;
    const tc = el(w, i + 4 + s.len);
    if (!tc || tc.id !== ID.Timecode || tc.end > w.length) continue;
    return { start: base + i, time: uint(w, tc) * scale / 1e9 };
  }
  return null;
}
function lastTimeIn(w, scale = 1e6) {
  let last = null;
  for (let i = 0; i + 8 < w.length; ) {
    const c = clusterIn(w.subarray(i), i, scale);
    if (!c) break;
    last = c;
    i = c.start + 4;
  }
  if (!last) return null;
  const ci = el(w, last.start);
  let maxRel = 0;
  for (const x of kids(w, ci.body, ci.unknown ? w.length : Math.min(ci.end, w.length))) {
    if (x.id === ID.Cluster) break;
    const blk = x.id === ID.SimpleBlock ? x : x.id === ID.BlockGroup ? kids(w, x.body, x.end).find((k) => k.id === ID.Block) : null;
    if (!blk || blk.end > w.length) continue;
    const tn = vint(w, blk.body);
    if (!tn) continue;
    const rel = (w[blk.body + tn.len] << 8 | w[blk.body + tn.len + 1]) << 16 >> 16;
    maxRel = Math.max(maxRel, rel);
  }
  return last.time + maxRel * scale / 1e9;
}

// vendor/taperelay-client/src/mediasource.mjs
var PIECE = 512 * 1024;
var PROBE2 = 256 * 1024;
var HEAD = 64 * 1024;
var MAX_TOP_BOXES2 = 4096;
var MAX_INDEX = 16 * 1048576;
var coded = (code, message) => Object.assign(new Error(message), { code });
var once = (t, ev) => new Promise((ok) => t.addEventListener(ev, ok, { once: true }));
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
var MP4_TOP = /* @__PURE__ */ new Set(["ftyp", "styp", "moov", "mdat", "free", "skip", "wide", "pnot", "uuid", "sidx", "moof", "meta", "pdin", "prft"]);
var mediaSourceClass = () => globalThis.ManagedMediaSource ?? globalThis.MediaSource ?? null;
async function scan(reader, off, find) {
  for (let a = off; a < reader.size; a += PROBE2 - 16384) {
    const m = find(await reader.read(a, Math.min(reader.size, a + PROBE2)), a);
    if (m) return m;
  }
  return null;
}
async function fromTail(reader, from, find) {
  for (let back = 4 * PROBE2; ; back *= 2) {
    const off = Math.max(from, reader.size - back);
    const v = find(await reader.read(off, reader.size), off);
    if (v !== null && v !== void 0) return v;
    if (off === from) return null;
  }
}
var indexAt = (index, t) => {
  let lo = 0, hi = index.length - 1;
  while (lo < hi) {
    const m = lo + hi + 1 >> 1;
    if (index[m].time <= t) lo = m;
    else hi = m - 1;
  }
  return index[lo];
};
function rawCursor(src, reader, stats) {
  return {
    async positionFor(t) {
      if (t <= 0) return { pos: src.startAt, at: 0 };
      if (src.index) {
        const e = indexAt(src.index, t);
        return { pos: Math.max(src.startAt, e.offset), at: e.time };
      }
      let lo = src.startAt, hi = reader.size, best = src.startAt, bestT = 0;
      while (hi - lo > PROBE2) {
        const mid = Math.floor((lo + hi) / 2);
        const m = await src.probe(mid);
        stats.seekProbes++;
        if (!m || m.time > t) hi = mid;
        else {
          best = m.start;
          bestT = m.time;
          lo = m.start + 1;
        }
      }
      for (let off = lo; off < hi; ) {
        const m = await src.probe(off);
        stats.seekProbes++;
        if (!m || m.time > t || m.start >= hi) break;
        best = m.start;
        bestT = m.time;
        off = m.start + 1;
      }
      return { pos: best, at: bestT };
    },
    async next(pos) {
      if (pos >= reader.size) return null;
      const end = Math.min(reader.size, pos + PIECE);
      return { bytes: await reader.read(pos, end), pos: end };
    }
  };
}
async function mp4Source(reader) {
  const size = reader.size;
  let p = 0, moov = null, firstMoof = null, sidx = null;
  for (let n = 0; p + 8 <= size && n < MAX_TOP_BOXES2; n++) {
    const h = await reader.read(p, Math.min(size, p + 16));
    const x = boxAt(h, 0, size - p);
    if (!x || n === 0 && !MP4_TOP.has(x.type)) throw coded("not-streamable", n === 0 ? "\u4E0D\u662F MP4" : "MP4 \u7684\u9876\u5C42\u76D2\u5B50\u5199\u574F\u4E86");
    if (x.end > size && (x.type === "moov" || x.type === "sidx")) throw coded("not-streamable", `MP4 \u7684 ${x.type} \u8D85\u51FA\u4E86\u6587\u4EF6`);
    if (x.type === "moov") {
      if (x.size > MAX_INDEX) throw coded("not-streamable", "moov \u592A\u5927");
      moov = parseMoov(await reader.read(p, p + x.size));
      if (!moov.fragmented) break;
    }
    if (x.type === "sidx" && !sidx && x.size <= MAX_INDEX) sidx = parseSidx(await reader.read(p, p + x.size), 0, p);
    if (x.type === "moof") {
      firstMoof = p;
      break;
    }
    p += x.size;
  }
  if (!moov) throw coded("not-streamable", "MP4 \u91CC\u627E\u4E0D\u5230 moov");
  const mime = mimeOf(moov);
  if (!mime) throw coded("unsupported", "\u52A0\u4E86 DRM \u6216\u6837\u672C\u63CF\u8FF0\u4E0D\u6B62\u4E00\u79CD\u7684 MP4");
  if (!moov.fragmented) {
    const frags = planFragments(moov, 2);
    const cursor = {
      async positionFor(t) {
        const k = fragmentAt(frags, Math.max(0, t - 0.5));
        return { pos: k, at: frags[k].t0 };
      },
      // 早半秒：编辑列表让显示时间比解码时间晚一点
      async next(k) {
        return k >= frags.length ? null : { bytes: await buildFragment(frags[k], k + 1, (a, b) => reader.read(a, b)), pos: k + 1 };
      }
    };
    return { kind: "remux-mp4", mime, duration: moov.duration, init: async () => buildInit(moov), cursor, fragments: frags.length };
  }
  if (firstMoof === null) throw coded("not-streamable", "\u5206\u6BB5\u7684 MP4 \u91CC\u6CA1\u6709 moof");
  const lead = moov.tracks.find((t) => t.handler === "vide") ?? moov.tracks[0];
  let index = sidx;
  if (!index && size >= 16) {
    const tail = await reader.read(size - 16, size);
    if (fourcc(tail, 4) === "mfro") {
      const n = u323(tail, 12);
      if (n > 16 && n <= Math.min(size, MAX_INDEX)) index = parseMfra(await reader.read(size - n, size), lead.id, lead.timescale);
    }
  }
  let duration = moov.duration || null;
  if (!duration) duration = await fromTail(reader, firstMoof, (w, off) => lastMoofEnd(w, off, lead));
  const src = {
    kind: "fmp4",
    mime,
    duration,
    startAt: firstMoof,
    index,
    init: () => reader.read(0, firstMoof),
    probe: (off) => scan(reader, off, (w, a) => {
      const m = moofIn(w, a, lead.id);
      return m && { start: m.start, time: m.time / lead.timescale };
    })
  };
  return src;
}
async function webmSource(reader) {
  const size = reader.size;
  let n = Math.min(size, HEAD), h;
  for (; ; ) {
    h = parseWebmHead(await reader.read(0, n));
    if (!h.need) break;
    if (n >= size || h.need > MAX_INDEX) throw coded("not-streamable", "WebM \u7684\u5934\u592A\u957F\u6216\u4E0D\u5B8C\u6574");
    n = Math.min(size, Math.max(h.need, n * 2));
  }
  if (!h.mime) throw coded("unsupported", "WebM \u91CC\u7684\u7F16\u7801\u4E0D\u662F VP8\u3001VP9\u3001AV1\u3001Opus\u3001Vorbis");
  let index = null;
  if (h.cuesAt !== null && h.cuesAt + 16 <= size) {
    const total = cuesSize(await reader.read(h.cuesAt, Math.min(size, h.cuesAt + 16)));
    if (total && total <= MAX_INDEX && h.cuesAt + total <= size) index = parseCues(await reader.read(h.cuesAt, h.cuesAt + total), h.segmentBody, h.timecodeScale);
  }
  let duration = h.duration;
  if (!duration) duration = await fromTail(reader, h.initEnd, (w) => lastTimeIn(w, h.timecodeScale));
  return {
    kind: "webm",
    mime: h.mime,
    duration,
    startAt: h.initEnd,
    index,
    init: () => reader.read(0, h.initEnd),
    probe: (off) => scan(reader, off, (w, a) => clusterIn(w, a, h.timecodeScale))
  };
}
async function openSource(reader, stats = { seekProbes: 0 }) {
  if (!reader.size) throw coded("not-streamable", "\u7A7A\u6587\u4EF6");
  const head = await reader.read(0, Math.min(reader.size, 16));
  if (head.length >= 4 && head[0] === 26 && head[1] === 69 && head[2] === 223 && head[3] === 163) {
    const s = await webmSource(reader);
    return { ...s, cursor: rawCursor(s, reader, stats) };
  }
  if (head.length >= 8 && MP4_TOP.has(fourcc(head, 4))) {
    const s = await mp4Source(reader);
    return s.cursor ? s : { ...s, cursor: rawCursor(s, reader, stats) };
  }
  throw coded("not-streamable", "\u4E0D\u662F MP4\u3001WebM");
}
async function streamMedia(media, reader, { ahead = 30, behind = 10, onError = () => {
} } = {}) {
  const MS = mediaSourceClass();
  if (!MS) throw coded("no-mse", "\u8FD9\u4E2A\u6D4F\u89C8\u5668\u6CA1\u6709 MediaSource");
  const stats = { seekProbes: 0, appends: 0, appended: 0, evictions: 0, gapsSkipped: 0 };
  const src = await openSource(reader, stats);
  if (!MS.isTypeSupported(src.mime)) throw coded("unsupported", `\u8FD9\u4E2A\u6D4F\u89C8\u5668\u7684 MediaSource \u4E0D\u6536 ${src.mime}`);
  const managed = MS === globalThis.ManagedMediaSource;
  const ms = new MS();
  media.disableRemotePlayback = true;
  let url = null;
  if (managed && "srcObject" in media) media.srcObject = ms;
  else {
    url = URL.createObjectURL(ms);
    media.src = url;
  }
  await once(ms, "sourceopen");
  const sb = ms.addSourceBuffer(src.mime);
  let closed = false, failed = false, gen = 0, pos = null;
  const fail3 = (e) => {
    if (closed || failed) return;
    failed = true;
    onError(e);
  };
  const settle = async () => {
    while (sb.updating) await once(sb, "updateend");
  };
  const append = async (bytes) => {
    await settle();
    sb.appendBuffer(bytes);
    await once(sb, "updateend");
    stats.appends++;
    stats.appended += bytes.length;
  };
  const remove = async (a, b) => {
    if (b - a < 0.5) return;
    await settle();
    sb.remove(a, b);
    await once(sb, "updateend");
    stats.evictions++;
  };
  const rangeAt = (t) => {
    const b = media.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.2 && b.end(i) > t) return [b.start(i), b.end(i)];
    return null;
  };
  async function evict(hard = false) {
    const t = media.currentTime, b = media.buffered, keepBack = hard ? 2 : behind, keepAhead = hard ? ahead : 2 * ahead;
    for (let i = b.length - 1; i >= 0; i--) {
      const s = b.start(i), e = b.end(i);
      if (e < t - keepBack) await remove(s, e);
      else if (s < t - keepBack) await remove(s, t - keepBack);
      if (s > t + keepAhead) await remove(s, e);
      else if (e > t + keepAhead && s <= t + keepAhead) await remove(t + keepAhead, e);
    }
  }
  async function feed(my) {
    let quota = 0;
    while (my === gen && !closed) {
      if (managed && !ms.streaming) {
        await sleep2(250);
        continue;
      }
      const r0 = rangeAt(media.currentTime);
      if (r0 && r0[1] - media.currentTime > ahead) {
        await sleep2(250);
        continue;
      }
      const r = await src.cursor.next(pos);
      if (my !== gen || closed) return;
      if (!r) {
        await settle();
        if (ms.readyState === "open" && my === gen) ms.endOfStream();
        return;
      }
      try {
        await append(r.bytes);
      } catch (e) {
        if (e?.name !== "QuotaExceededError") throw e;
        await evict(true);
        if (++quota > 3) await sleep2(1e3);
        continue;
      }
      quota = 0;
      pos = r.pos;
      if (stats.appends % 8 === 0) await evict();
    }
  }
  const run = (my) => feed(my).catch(fail3);
  async function onSeeking() {
    const my = ++gen, t = media.currentTime;
    try {
      await settle();
      if (my !== gen || closed) return;
      if (ms.readyState === "open") sb.abort();
      const r = rangeAt(t);
      if (r && Number.isFinite(ms.duration) && r[1] >= ms.duration - 0.05) {
        await settle();
        if (my === gen && !closed && ms.readyState === "open") ms.endOfStream();
        return;
      }
      const p = await src.cursor.positionFor(Math.max(0, (r ? r[1] : t) - 0.01));
      if (my !== gen || closed) return;
      pos = p.pos;
      run(my);
    } catch (e) {
      fail3(e);
    }
  }
  const watch = setInterval(() => {
    if (closed || media.paused || media.seeking || media.ended || media.readyState >= 3) return;
    const t = media.currentTime, b = media.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) > t && b.start(i) - t < 0.5) {
      media.currentTime = b.start(i) + 1e-3;
      stats.gapsSkipped++;
      return;
    }
    if (ms.readyState === "ended" && b.length && t >= b.end(b.length - 1) - 0.3 && Number.isFinite(media.duration) && media.duration - t < 0.5) {
      media.currentTime = media.duration;
      stats.gapsSkipped++;
    }
  }, 250);
  media.addEventListener("seeking", onSeeking);
  try {
    await append(await src.init());
    if (src.duration && ms.readyState === "open") {
      await settle();
      ms.duration = src.duration;
    }
    pos = (await src.cursor.positionFor(0)).pos;
  } catch (e) {
    clearInterval(watch);
    media.removeEventListener("seeking", onSeeking);
    if (url) URL.revokeObjectURL(url);
    try {
      if (managed) media.srcObject = null;
      else media.removeAttribute("src");
    } catch {
    }
    throw coded(e?.code ?? "unsupported", `\u5582\u4E0D\u8FDB MediaSource\uFF1A${String(e?.message ?? e)}`);
  }
  run(gen);
  return {
    kind: src.kind,
    mime: src.mime,
    duration: src.duration,
    stats,
    close() {
      if (closed) return;
      closed = true;
      gen++;
      clearInterval(watch);
      media.removeEventListener("seeking", onSeeking);
      try {
        if (ms.readyState === "open" && !sb.updating) ms.endOfStream();
      } catch {
      }
      if (url) URL.revokeObjectURL(url);
    }
  };
}

// vendor/taperelay-client/src/savefile.mjs
var SAVE_MEMORY_MAX = 200 * 1048576;
var TEMP_PREFIX = "taperelay-dl-";
var coded2 = (code, message) => Object.assign(new Error(message), { code });
var hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
var safeFileName = (name) => [...String(name ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "")].slice(0, 120).join("").replace(/[\\/:*?"<>|]/g, "_") || "file";
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.download = safeFileName(name);
  a.href = url;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 6e4);
}
async function pump(f, sink, onProgress) {
  const total = f.manifest.size;
  const whole = sha256.create();
  const at = (i) => Math.min(total, i * ENCRYPTED_CHUNK);
  const n = Math.ceil(total / ENCRYPTED_CHUNK);
  let next = n ? f.read(0, at(1)) : null;
  for (let i = 0; i < n; i++) {
    const bytes = await next;
    next = i + 1 < n ? f.read(at(i + 1), at(i + 2)) : null;
    next?.catch(() => {
    });
    whole.update(bytes);
    await sink(bytes);
    onProgress?.(at(i + 1), total);
  }
  if (f.manifest.sha256 && hexOf(whole.digest()) !== f.manifest.sha256) throw coded2("file-hash-mismatch", "\u6574\u4E2A\u6587\u4EF6\u7684 SHA-256 \u4E0E\u6E05\u5355\u4E0D\u7B26");
}
var opfsWritable = () => typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function" && typeof globalThis.FileSystemFileHandle === "function" && "createWritable" in globalThis.FileSystemFileHandle.prototype;
async function cleanupTempDownloads(maxAgeMs = 10 * 6e4) {
  if (!opfsWritable()) return 0;
  let n = 0;
  try {
    const root = await navigator.storage.getDirectory();
    for await (const [name, h] of root.entries()) {
      if (!name.startsWith(TEMP_PREFIX) || h.kind !== "file") continue;
      const file = await h.getFile();
      if (Date.now() - file.lastModified > maxAgeMs) {
        await root.removeEntry(name);
        n++;
      }
    }
  } catch {
  }
  return n;
}
function saveFile(f, { name, memoryMax = SAVE_MEMORY_MAX, onProgress, tiers = ["picker", "opfs", "memory"] } = {}) {
  const total = f.manifest.size;
  let pick = null;
  if (tiers.includes("picker") && typeof globalThis.showSaveFilePicker === "function") {
    try {
      pick = globalThis.showSaveFilePicker({ suggestedName: safeFileName(name) });
    } catch (e) {
      pick = Promise.reject(e);
    }
    pick.catch(() => {
    });
  }
  return (async () => {
    if (pick) {
      let handle = null;
      try {
        handle = await pick;
      } catch (e) {
        if (e?.name === "AbortError") return { how: "cancelled" };
      }
      if (handle) {
        const w = await handle.createWritable();
        try {
          await pump(f, (b) => w.write(b), (d, t) => onProgress?.(d, t, "picker"));
          await w.close();
        } catch (e) {
          await w.abort().catch(() => {
          });
          throw e;
        }
        return { how: "picker" };
      }
    }
    if (tiers.includes("opfs") && opfsWritable()) {
      let root = null, free = 0;
      try {
        root = await navigator.storage.getDirectory();
        const e = await navigator.storage.estimate();
        free = (e.quota ?? 0) - (e.usage ?? 0);
      } catch {
        root = null;
      }
      if (root && free > total * 2.1 + 16 * 1048576) {
        const tmp = `${TEMP_PREFIX}${Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => x.toString(16).padStart(2, "0")).join("")}`;
        let w = null;
        try {
          const fh = await root.getFileHandle(tmp, { create: true });
          w = await fh.createWritable();
          await pump(f, (b) => w.write(b), (d, t) => onProgress?.(d, t, "opfs"));
          await w.close();
          w = null;
          downloadBlob(await fh.getFile(), name);
          return { how: "opfs" };
        } catch (e) {
          await w?.abort().catch(() => {
          });
          await root.removeEntry(tmp).catch(() => {
          });
          if (e?.code) throw e;
        }
      }
    }
    if (!tiers.includes("memory") || total > memoryMax) throw coded2("too-large-to-save", "\u8FD9\u4E2A\u6D4F\u89C8\u5668\u5B58\u4E0D\u4E86\u8FD9\u4E48\u5927\u7684\u6587\u4EF6");
    const parts = [];
    await pump(f, (b) => {
      parts.push(b);
    }, (d, t) => onProgress?.(d, t, "memory"));
    downloadBlob(new Blob(parts, { type: "application/octet-stream" }), name);
    return { how: "memory" };
  })();
}
export {
  ENCRYPTED_CHUNK,
  cleanupTempDownloads,
  createClient,
  faststart,
  generateKeyPair,
  openEncryptedFileWithKey,
  planEncryptedFile,
  planEncryptedResume,
  readEncryptedFileWithKey,
  remoteAuth,
  resumableOf,
  saveFile,
  sha256,
  streamMedia,
  uploadToServers
};
