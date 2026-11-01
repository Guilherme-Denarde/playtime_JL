// Holds the app state and saves it to the chosen database: this device, or Supabase.
import { emptyState, mergeStates, canon } from './logic.js';
import { Cloud, AuthError } from './cloud.js';

const KEYS = {
  state: 'playtime.state',
  config: 'playtime.config', // { mode: 'local' } or { mode: 'cloud', url, anonKey }
  auth: 'playtime.auth', // local password hash
  session: 'playtime.session', // local: { loggedIn } / cloud: tokens
  backup: 'playtime.lastBackup',
  pinTries: 'playtime.pinTries',
  loginTries: 'playtime.loginTries',
};
export { KEYS };

const readJson = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};
const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
// Compares content only: list order and jsonb key order do not count as a change.
const sameData = (a, b) => canon(mergeStates(a, a)) === canon(mergeStates(b, b));

class Store {
  constructor() {
    this.state = readJson(KEYS.state) || emptyState();
    this.config = readJson(KEYS.config);
    this.listeners = new Set();
    this.syncStatus = 'idle'; // idle | syncing | offline | error
    this.syncError = null;
    this.dirty = false;
    this.cloud = null;
    this.saveFailed = false;
    if (this.config?.mode === 'cloud') this.connect(this.config, readJson(KEYS.session));
    window.addEventListener('online', () => this.sync());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.sync(); });
    setInterval(() => { if (!document.hidden) this.sync(); }, 20_000);
  }

  // ----- auth state -----
  get isCloud() { return this.config?.mode === 'cloud'; }
  get isLoggedIn() {
    const s = readJson(KEYS.session);
    return this.isCloud ? Boolean(s?.accessToken) : Boolean(s?.loggedIn);
  }
  get localAuth() { return readJson(KEYS.auth); }

  connect(config, session = null) {
    this.cloud = new Cloud(config, session, (next) => writeJson(KEYS.session, next));
    return this.cloud;
  }
  useLocal(authRecord) {
    this.config = { mode: 'local' };
    this.cloud = null;
    writeJson(KEYS.config, this.config);
    writeJson(KEYS.auth, authRecord);
    writeJson(KEYS.session, { loggedIn: true });
    this.dirty = false;
    this.syncStatus = 'idle';
    this.persist();
    this.emit();
  }
  useCloud(config) {
    this.config = { mode: 'cloud', url: config.url, anonKey: config.anonKey };
    writeJson(KEYS.config, this.config);
    localStorage.removeItem(KEYS.auth);
  }
  setLocalAuth(authRecord) { writeJson(KEYS.auth, authRecord); }
  markLoggedInLocal() { writeJson(KEYS.session, { loggedIn: true }); }

  /** In cloud mode this also clears the device's copy, since the data lives online. */
  logout() {
    localStorage.removeItem(KEYS.session);
    if (this.isCloud) {
      localStorage.removeItem(KEYS.state);
      this.state = emptyState();
      this.cloud.session = null;
    }
  }
  eraseEverything() {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  }

  // ----- state -----
  subscribe(fn) { this.listeners.add(fn); }
  emit() { this.listeners.forEach((fn) => fn()); }

  persist() {
    try {
      writeJson(KEYS.state, this.state);
      this.saveFailed = false;
    } catch {
      this.saveFailed = true; // storage full or blocked: the app shows a warning
    }
  }

  /** Applies a change to a copy of the state, then saves and notifies. */
  update(mutator) {
    const draft = structuredClone(this.state);
    const result = mutator(draft);
    this.state = draft;
    this.dirty = true;
    this.persist();
    this.emit();
    if (this.isCloud) {
      clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => this.sync(), 600);
    }
    return result;
  }
  replace(next) {
    this.state = next;
    this.dirty = true;
    this.persist();
    this.emit();
    if (this.isCloud) this.sync();
  }

  markBackedUp() { localStorage.setItem(KEYS.backup, String(Date.now())); }
  get lastBackup() { return Number(localStorage.getItem(KEYS.backup)) || null; }

  // ----- cloud sync -----
  /** Pull, merge by record, push. Resolves true once this device and the cloud match. */
  async sync() {
    if (!this.isCloud || !this.cloud?.session?.accessToken) return false;
    if (this.syncing) { this.syncAgain = true; return this.syncing; }
    this.syncing = this.runSync().finally(() => {
      this.syncing = null;
      if (this.syncAgain) { this.syncAgain = false; this.sync(); }
    });
    return this.syncing;
  }

  async runSync() {
    this.setSync('syncing');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const row = await this.cloud.fetchRow();
        const remote = row?.data || emptyState();
        const merged = mergeStates(this.state, remote);
        if (!sameData(merged, this.state)) {
          this.state = merged;
          this.persist();
          this.emit();
        }
        const snapshot = this.state;
        let saved = true;
        if (!row) saved = await this.cloud.insertRow(snapshot);
        else if (!sameData(remote, snapshot)) saved = await this.cloud.updateRow(snapshot, row.version);
        if (saved) {
          // An edit made while saving is picked up by one more round.
          if (this.state === snapshot) this.dirty = false;
          else this.syncAgain = true;
          this.setSync('idle');
          return true;
        }
      }
      throw new Error('Another device keeps saving. Will try again shortly.');
    } catch (err) {
      if (err instanceof AuthError) {
        this.setSync('error', err.message);
      } else if (err instanceof TypeError) {
        this.setSync('offline'); // fetch network failure
      } else {
        this.setSync('error', err.message);
      }
      return false;
    }
  }

  setSync(status, error = null) {
    const changed = status !== this.syncStatus || error !== this.syncError;
    this.syncStatus = status;
    this.syncError = error;
    if (changed && this.onSyncChange) this.onSyncChange();
  }
}

export const store = new Store();
