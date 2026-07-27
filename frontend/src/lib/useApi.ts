import { useCallback, useEffect, useState } from "react";
import api from "../api/client";
import { useRealtime } from "../store/realtime";

export function useApi<T>(url: string, deps: any[] = []) {
  const { version } = useRealtime();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get<T>(url);
      setData(res.data);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => {
    load();
  }, [load, version]);

  return { data, loading, error, reload: load, setData };
}
