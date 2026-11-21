// Passcode hashing, Face ID / fingerprint (WebAuthn) and device-transfer codes.
//
// The lock is a privacy screen: it stops someone who picks up your phone from seeing your numbers.
// It does not encrypt the saved data (anyone with access to the browser's storage could still read it).

const enc = new TextEncoder();

export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of salt + passcode, as hex. Falls back to a simple hash where the browser has no Web Crypto. */
export async function hashPin(pin, salt) {
  const data = enc.encode(`${salt}:${pin}`);
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381;
  for (let r = 0; r < 1000; r++) for (const b of data) h = ((h * 33) ^ b ^ r) >>> 0;
  return `x${h.toString(16)}`;
}

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** True if this device can unlock with Face ID / Touch ID / fingerprint here. */
export async function biometricAvailable() {
  try {
    return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch {
    return false;
  }
}

/** Register Face ID / fingerprint for this app on this device. Returns the credential id to store. */
export async function registerBiometric() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Coin Quest' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'coin-quest', displayName: 'Coin Quest' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    },
  });
  return toB64(cred.rawId);
}

/** Ask for Face ID / fingerprint. Resolves true when the person is verified. */
export async function verifyBiometric(credId) {
  const res = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: fromB64(credId) }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return !!res;
}

// ---------- transfer codes ----------
// A transfer code is the whole save as text: gzip-compressed where the browser supports it (prefix CQ1:),
// plain otherwise (CQ0:). Copy it on one device and paste it on another.

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeTransfer(state) {
  const json = JSON.stringify(state);
  if (typeof CompressionStream !== 'undefined') return `CQ1:${toB64(await gzip(json))}`;
  return `CQ0:${toB64(enc.encode(json))}`;
}

/** Returns the parsed save (not yet validated), or throws a readable error. */
export async function decodeTransfer(code) {
  const c = String(code || '').replace(/\s+/g, '');
  try {
    if (c.startsWith('CQ1:')) {
      const bytes = fromB64(c.slice(4));
      const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      return JSON.parse(out);
    }
    if (c.startsWith('CQ0:')) return JSON.parse(new TextDecoder().decode(fromB64(c.slice(4))));
  } catch {
    throw new Error('That code is damaged or incomplete. Copy the whole code and try again.');
  }
  throw new Error("That doesn't look like a Coin Quest transfer code.");
}
