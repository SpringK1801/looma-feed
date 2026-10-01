import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export function useStorageUrl(bucket: string, path: string | null | undefined) {
  const [result, setResult] = useState<{ path: string; url: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!path) return;
    let active = true;
    async function refresh() {
      const { data } = await getSupabaseBrowserClient()
        .storage.from(bucket)
        .createSignedUrl(path!, 3600);
      if (active) setResult(data ? { path: path!, url: data.signedUrl } : null);
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 50 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [bucket, path, retry]);
  return {
    url: result && result.path === path ? result.url : null,
    retry: () => setRetry((value) => value + 1),
  };
}
