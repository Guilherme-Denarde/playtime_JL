// Salted PBKDF2 hashes for the local password and the admin PIN.
const ITERATIONS = 210_000;
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(secret, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashSecret(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), iter: ITERATIONS, hash: b64(await derive(secret, salt, ITERATIONS)) };
}

export async function verifySecret(secret, rec) {
  if (!rec) return false;
  return b64(await derive(secret, unb64(rec.salt), rec.iter)) === rec.hash;
}

/** Slows down repeated guessing: after 5 misses, waits start at 30s and double. */
export function attemptLimiter(storageKey) {
  const read = () => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || { fails: 0, until: 0 }; } catch { return { fails: 0, until: 0 }; }
  };
  return {
    waitMs: () => Math.max(0, read().until - Date.now()),
    fail() {
      const r = read();
      r.fails += 1;
      if (r.fails >= 5) r.until = Date.now() + 30_000 * 2 ** (r.fails - 5);
      localStorage.setItem(storageKey, JSON.stringify(r));
    },
    reset: () => localStorage.removeItem(storageKey),
  };
}
