import { useEffect, useRef, useState } from "react";
import {
  convertPhoto,
  loadVideo,
  MEDIA_ACCEPT,
  trimVideo,
  validateMedia,
  type PreparedMedia,
} from "@/lib/media";

export function MediaPicker({
  value,
  onChange,
  disabled,
  onBusyChange,
}: {
  value: PreparedMedia | null;
  onChange: (value: PreparedMedia | null) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [source, setSource] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const previewVideo = useRef<HTMLVideoElement>(null);
  const file = source ?? value?.file;
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    onBusyChange(busy || Boolean(source && !value));
  }, [busy, source, value, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  function processing(next: boolean) {
    setBusy(next);
  }
  async function select(file: File) {
    processing(true);
    setError(null);
    setSource(null);
    onChange(null);
    try {
      validateMedia(file);
      if (file.type.startsWith("image/"))
        onChange({ file: await convertPhoto(file), duration: null });
      else {
        const loaded = await loadVideo(file);
        const seconds = loaded.video.duration;
        loaded.dispose();
        setDuration(seconds);
        setStart(0);
        setLength(Math.min(10, seconds));
        setSource(file);
        if (seconds <= 10) onChange({ file, duration: seconds });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível preparar a mídia.");
    } finally {
      processing(false);
    }
  }
  async function cut() {
    if (!source) return;
    processing(true);
    setError(null);
    try {
      onChange(await trimVideo(source, start, length));
      setSource(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha no corte.");
    } finally {
      processing(false);
    }
  }
  return (
    <fieldset className="media-picker" disabled={disabled || busy}>
      <label>
        Adicionar foto ou vídeo
        <input
          type="file"
          accept={MEDIA_ACCEPT}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            if (selected) void select(selected);
          }}
        />
      </label>
      <small>
        Fotos até 5 MB, convertidas para WebP. Vídeos até 25 MB e 10 s. GIFs tornam-se fotos
        estáticas.
      </small>
      {preview &&
        (file?.type.startsWith("video/") ? (
          <video ref={previewVideo} src={preview} controls playsInline className="post-media" />
        ) : (
          <img src={preview} alt="Pré-visualização da foto" className="post-media" />
        ))}
      {source && (
        <div className="media-trim">
          <p>
            Vídeo original: {duration.toFixed(1)} s. Escolha um trecho de até 10 s e aplique o
            corte.
          </p>
          <label>
            Início (segundos)
            <input
              type="number"
              min={0}
              max={Math.max(0, duration - length)}
              step="0.1"
              value={start}
              onChange={(event) => {
                const next = Math.min(
                  Math.max(0, Number(event.target.value)),
                  Math.max(0, duration - length),
                );
                setStart(next);
                onChange(null);
                if (previewVideo.current) previewVideo.current.currentTime = next;
              }}
            />
          </label>
          <label>
            Duração (segundos)
            <input
              type="number"
              min="0.1"
              max={Math.min(10, duration - start)}
              step="0.1"
              value={length}
              onChange={(event) => {
                setLength(
                  Math.min(Math.max(0.1, Number(event.target.value)), 10, duration - start),
                );
                onChange(null);
              }}
            />
          </label>
          <button type="button" onClick={() => void cut()}>
            Aplicar corte
          </button>
        </div>
      )}
      {(source || value) && (
        <button
          type="button"
          onClick={() => {
            setSource(null);
            onChange(null);
            setError(null);
          }}
        >
          Remover mídia
        </button>
      )}
      {busy && <p role="status">A preparar mídia… Mantenha esta página aberta.</p>}
      {error && <p role="alert">{error}</p>}
      {source && !value && !busy && <p role="status">Aplique o corte antes de publicar.</p>}
    </fieldset>
  );
}
