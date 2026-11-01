// Minimal Supabase client (auth + one table) over fetch, so the app has no dependencies.
const TABLE = 'playtime_state';

export function normalizeUrl(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { throw new Error('That project URL does not look right.'); }
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !isLocal) throw new Error('The project URL must start with https://');
  return u.origin;
}

export class AuthError extends Error {}

export class Cloud {
  constructor({ url, anonKey }, session, onSession) {
    this.url = url;
    this.anonKey = anonKey;
    this.session = session;
    this.onSession = onSession;
  }

  async authCall(path, body) {
    let res;
    try {
      res = await fetch(`${this.url}/auth/v1/${path}`, {
        method: 'POST',
        headers: { apikey: this.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Could not reach the cloud database. Check your connection and project URL.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AuthError(data.error_description || data.msg || data.message || 'Sign-in failed.');
    return data;
  }

  store(data) {
    this.session = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user?.id ?? this.session?.userId,
      email: data.user?.email ?? this.session?.email,
    };
    this.onSession(this.session);
  }

  async signIn(email, password) {
    this.store(await this.authCall('token?grant_type=password', { email, password }));
  }

  /** Returns false when the project requires email confirmation before first sign-in. */
  async signUp(email, password) {
    const data = await this.authCall('signup', { email, password });
    if (!data.access_token) return false;
    this.store(data);
    return true;
  }

  async refresh() {
    if (!this.session?.refreshToken) throw new AuthError('Please sign in again.');
    this.store(await this.authCall('token?grant_type=refresh_token', { refresh_token: this.session.refreshToken }));
  }

  async rest(query, init = {}, retry = true) {
    const res = await fetch(`${this.url}/rest/v1/${TABLE}${query}`, {
      ...init,
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.session?.accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    if (res.status === 401 && retry) {
      await this.refresh();
      return this.rest(query, init, false);
    }
    return res;
  }

  /** The signed-in user's row, or null if they have none yet. */
  async fetchRow() {
    const res = await this.rest(`?user_id=eq.${this.session.userId}&select=data,version`);
    if (!res.ok) throw await tableError(res);
    return (await res.json())[0] || null;
  }

  /** False means another device created the row first. */
  async insertRow(data) {
    const res = await this.rest('', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: this.session.userId, data, version: 1 }),
    });
    if (res.status === 409) return false;
    if (!res.ok) throw await tableError(res);
    return true;
  }

  /** False means another device saved first, so the caller merges and retries. */
  async updateRow(data, version) {
    const res = await this.rest(`?user_id=eq.${this.session.userId}&version=eq.${version}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ data, version: version + 1, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw await tableError(res);
    return (await res.json()).length > 0;
  }
}

async function tableError(res) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 404 || body.code === '42P01' || body.code === 'PGRST205') {
    return new Error('The cloud table is missing. Run supabase/schema.sql in your project first.');
  }
  return new Error(body.message || `Cloud error (${res.status}).`);
}
