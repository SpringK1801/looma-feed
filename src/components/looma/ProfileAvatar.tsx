import { useStorageUrl } from "@/lib/use-storage-url";
import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";

type ProfileAvatarProps = {
  fullName: string;
  avatarUrl?: string | null | undefined;
  className?: string;
};

export function ProfileAvatar({ fullName, avatarUrl, className = "" }: ProfileAvatarProps) {
  const privatePath = avatarUrl?.startsWith("storage:profile-media/")
    ? avatarUrl.slice("storage:profile-media/".length)
    : null;
  const { url } = useStorageUrl("profile-media", privatePath);
  const resolvedUrl = privatePath ? url : avatarUrl;
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [resolvedUrl]);

  return (
    <span className={`${className} looma-avatar-frame`} aria-hidden="true">
      {resolvedUrl && !imageFailed ? (
        <img
          className="looma-avatar-image"
          src={resolvedUrl}
          alt=""
          onError={() => setImageFailed(true)}
        />
      ) : (
        <UserRound className="looma-avatar-anonymous" aria-hidden="true" />
      )}
    </span>
  );
}
