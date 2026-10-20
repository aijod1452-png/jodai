import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiClient, SESSION_KEY } from "./api-client";

interface AuthContextType {
  isLocked: boolean;
  isInitialized: boolean | null;
  isLoading: boolean;
  offline: boolean;
  login: (passcode: string) => Promise<void>;
  setupPasscode: (passcode: string) => Promise<void>;
  lock: () => void;
  retry: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLocked, setIsLocked] = useState(true);
  const [isInitialized, setIsInitialized] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const checkStatus = async () => {
    setIsLoading(true);
    setOffline(false);
    try {
      const status = await ApiClient.request("auth-service/status", { method: "GET" });
      setIsInitialized(!!status.initialized);
      const token = localStorage.getItem(SESSION_KEY);
      if (status.initialized && token) {
        try {
          await ApiClient.request("auth-service/check-session", { method: "POST", body: JSON.stringify({}) });
          setIsLocked(false);
        } catch {
          localStorage.removeItem(SESSION_KEY);
          setIsLocked(true);
        }
      } else setIsLocked(true);
    } catch {
      setIsInitialized(null); // don't assume uninitialized while offline
      setOffline(true);
      setIsLocked(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
    const onInvalid = () => setIsLocked(true);
    window.addEventListener("auth_invalid", onInvalid);
    return () => window.removeEventListener("auth_invalid", onInvalid);
  }, []);

  const login = async (passcode: string) => {
    const res = await ApiClient.request("auth-service/verify", { method: "POST", body: JSON.stringify({ passcode }) });
    localStorage.setItem(SESSION_KEY, res.token);
    setIsLocked(false);
  };
  const setupPasscode = async (passcode: string) => {
    const res = await ApiClient.request("auth-service/setup", { method: "POST", body: JSON.stringify({ passcode }) });
    localStorage.setItem(SESSION_KEY, res.token);
    setIsInitialized(true);
    setIsLocked(false);
  };
  const lock = () => {
    ApiClient.request("auth-service/lock", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    setIsLocked(true);
  };

  return (
    <AuthContext.Provider value={{ isLocked, isInitialized, isLoading, offline, login, setupPasscode, lock, retry: checkStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
