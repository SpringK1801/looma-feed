import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 10;
export const MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
export type PreparedMedia = { file: File; duration: number | null };
export type PostMediaData = {
  media_path: string | null;
  media_type: string | null;
  media_size: number | null;
  media_duration: number | null;
};
export const MEDIA_COLUMNS = "media_path, media_type, media_size, media_duration";

export function validateMedia(file: File) {
  if (!MEDIA_ACCEPT.split(",").includes(file.type))
    throw new Error("Escolha uma foto JPG, PNG, WebP ou GIF, ou um vídeo MP4, WebM ou MOV.");
  const max = file.type.startsWith("image/") ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
  if (!file.size || file.size > max)
    throw new Error(`O limite é ${max / 1024 / 1024} MB por ficheiro.`);
}

export async function convertPhoto(file: File, maxBytes = MAX_PHOTO_BYTES): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível converter esta foto.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Falha ao converter a foto."))),
        "image/webp",
        0.82,
      ),
    );
    if (blob.type !== "image/webp") throw new Error("Este navegador não suporta conversão WebP.");
    if (blob.size > maxBytes)
      throw new Error("A foto convertida excede o limite. Escolha uma foto menor.");
    return new File([blob], "photo.webp", { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}

export async function loadVideo(file: File) {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.preload = "auto";
  video.playsInline = true;
  const dispose = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("O vídeo demorou demasiado a abrir.")),
        15000,
      );
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Não foi possível abrir este vídeo. Experimente MP4 ou WebM."));
      };
      video.src = url;
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0)
      throw new Error("Não foi possível verificar a duração do vídeo.");
    return { video, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

// Re-encode only the selected interval locally; no original video is uploaded.
export async function trimVideo(file: File, start: number, length: number): Promise<PreparedMedia> {
  if (typeof MediaRecorder === "undefined")
    throw new Error(
      "Este navegador não permite cortar vídeos. Envie um vídeo já cortado até 10 s.",
    );
  const mimeType = ["video/webm;codecs=vp8,opus", "video/mp4", "video/webm"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType) throw new Error("Corte indisponível neste navegador. Envie um vídeo até 10 s.");
  const { video, dispose } = await loadVideo(file);
  let audio: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let frame = 0;
  try {
    if (start < 0 || length <= 0 || length > 10 || start + length > video.duration + 0.01)
      throw new Error("Selecione um trecho válido de até 10 segundos.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
    canvas.height = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);
    const context = canvas.getContext("2d")!;
    if (start > 0)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Não foi possível posicionar o corte.")),
          10000,
        );
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
        video.currentTime = start;
      });
    audio = new AudioContext();
    await audio.resume();
    const destination = audio.createMediaStreamDestination();
    audio.createMediaElementSource(video).connect(destination);
    stream = canvas.captureStream(30);
    destination.stream.getAudioTracks().forEach((track) => stream!.addTrack(track));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 });
    const chunks: Blob[] = [];
    const blob = await new Promise<Blob>((resolve, reject) => {
      const stop = () => {
        if (recorder.state !== "inactive") recorder.stop();
        video.pause();
      };
      const timer = setTimeout(stop, Math.max(1, length * 1000 - 100));
      const onHidden = () => {
        if (document.hidden) {
          stop();
          reject(
            new Error("O corte foi interrompido. Mantenha esta página visível e tente novamente."),
          );
        }
      };
      document.addEventListener("visibilitychange", onHidden);
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        clearTimeout(timer);
        stop();
        reject(new Error("Falha ao cortar o vídeo."));
      };
      recorder.onstop = () => {
        document.removeEventListener("visibilitychange", onHidden);
        clearTimeout(timer);
        resolve(new Blob(chunks, { type: mimeType.split(";")[0]! }));
      };
      const draw = () => {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (video.currentTime >= start + length || video.ended) stop();
        else frame = requestAnimationFrame(draw);
      };
      recorder.start();
      void video
        .play()
        .then(draw)
        .catch(() => {
          stop();
          reject(new Error("Não foi possível reproduzir o vídeo para corte."));
        });
    });
    const output = new File([blob], blob.type === "video/mp4" ? "clip.mp4" : "clip.webm", {
      type: blob.type,
    });
    validateMedia(output);
    return { file: output, duration: length };
  } finally {
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    await audio?.close();
    dispose();
  }
}

export async function uploadPostMedia(
  userId: string,
  media: PreparedMedia | null,
): Promise<PostMediaData> {
  if (!media) return { media_path: null, media_type: null, media_size: null, media_duration: null };
  validateMedia(media.file);
  if (
    media.file.type.startsWith("video/") &&
    (!media.duration ||
      !Number.isFinite(media.duration) ||
      media.duration <= 0 ||
      media.duration > 10)
  )
    throw new Error("O vídeo deve ter no máximo 10 segundos.");
  const extension =
    media.file.type === "image/webp"
      ? "webp"
      : media.file.type === "video/mp4"
        ? "mp4"
        : media.file.type === "video/quicktime"
          ? "mov"
          : "webm";
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await getSupabaseBrowserClient()
    .storage.from("post-media")
    .upload(path, media.file, { contentType: media.file.type, upsert: false });
  if (error) throw new Error(`Não foi possível enviar a mídia: ${error.message}`);
  return {
    media_path: path,
    media_type: media.file.type,
    media_size: media.file.size,
    media_duration: media.duration,
  };
}

export async function removePostMedia(path: string | null | undefined) {
  if (!path) return;
  const { error } = await getSupabaseBrowserClient().storage.from("post-media").remove([path]);
  if (error) console.error("Falha ao remover mídia do storage", error);
}
