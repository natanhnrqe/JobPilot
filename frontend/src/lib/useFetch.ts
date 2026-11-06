import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

export interface FetchState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/** Busca simples com recarga manual (sem biblioteca de estado). */
export function useFetch<T>(path: string | null, deps: unknown[] = []): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (path === null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: ApiError) => {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, tick, ...deps]);

  return { data, error, loading, reload };
}

/** Extrai mensagem legível de um erro de API. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = err.details.issues;
    if (Array.isArray(issues) && issues.length > 0) {
      const parts = issues
        .map((i) => {
          const issue = i as { campo?: string; problema?: string };
          return `${issue.campo}: ${issue.problema}`;
        })
        .join("; ");
      return `${err.message} (${parts})`;
    }
    // Motivo devolvido pelo provedor (ex.: "model is overloaded"), quando houver.
    const trecho = err.details.trecho;
    if (typeof trecho === "string" && trecho.trim() !== "") {
      return `${err.message} Detalhe do provedor: ${trecho.trim()}`;
    }
    return err.message;
  }
  return String(err);
}
