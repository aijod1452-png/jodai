const BASE_URL = "/api/public/hub";
export const SESSION_KEY = "aih_session_token";

export class ApiClient {
  private static getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(SESSION_KEY);
  }

  public static async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers = new Headers(options.headers || {});
    headers.set("Content-Type", "application/json");
    if (token) headers.set("x-session-token", token);
    const res = await fetch(`${BASE_URL}/${endpoint}`, { ...options, headers });
    const json: any = await res.json().catch(() => ({}));
    // Only clear the session for real session failures, not a wrong PIN.
    if (res.status === 401 && json.error && /session|unauthorized/i.test(json.error)) {
      localStorage.removeItem(SESSION_KEY);
      window.dispatchEvent(new Event("auth_invalid"));
    }
    if (!res.ok) {
      const error: any = new Error(json.error || `HTTP ${res.status}`);
      error.status = res.status;
      error.data = json;
      throw error;
    }
    return json as T;
  }
}
