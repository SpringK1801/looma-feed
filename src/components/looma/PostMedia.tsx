import { useEffect, useState } from "react";
import { useStorageUrl } from "@/lib/use-storage-url";

export function PostMedia({ path, type }: { path?: string | null; type?: string | null }) {
  const { url, retry } = useStorageUrl("post-media", path);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!path) return null;
  if (!url || failed)
    return (
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          retry();
        }}
      >
        Carregar mídia
      </button>
    );
  return type?.startsWith("video/") ? (
    <video
      className="post-media"
      src={url}
      controls
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
    />
  ) : (
    <img
      className="post-media"
      src={url}
      alt="Foto da publicação"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
