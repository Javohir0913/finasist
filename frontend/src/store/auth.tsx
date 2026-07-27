import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import api from "../api/client";

export interface Me {
  id: number;
  email: string;
  full_name: string;
  is_superadmin: boolean;
  organization_id: number | null;
  role: { id: number; name: string } | null;
  permissions: string[];
}

interface AuthCtx {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (perm: string) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!localStorage.getItem("token")) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get<Me>("/auth/me");
      setUser(data);
    } catch {
      localStorage.removeItem("token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const login = async (email: string, password: string) => {
    const form = new URLSearchParams();
    form.set("username", email);
    form.set("password", password);
    const { data } = await api.post("/auth/login", form);
    localStorage.setItem("token", data.access_token);
    await refresh();
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
    location.href = "/login";
  };

  const can = (perm: string) => {
    if (!user) return false;
    if (user.is_superadmin) return true;
    return user.permissions.includes(perm);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, can, refresh }}>{children}</Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
