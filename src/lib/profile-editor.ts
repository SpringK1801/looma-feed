import { convertPhoto } from "@/lib/media";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Profile } from "@/lib/profile";

export const ACCEPTED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

type SaveProfileDetailsInput = {
  user: User;
  profile: Profile | null;
  fullName: string;
  bio: string;
  avatarFile: File | null;
  username?: string;
};

export type UserSkillExperienceLevel = "iniciante" | "intermediario" | "experiente";

export type EditableUserSkill = {
  id: string;
  experienceLevel: UserSkillExperienceLevel | null;
};

export type EditableProfileLink = {
  type: "instagram" | "youtube" | "tiktok" | "outro";
  label: string | null;
  url: string;
};

export function getAvatarFileValidationError(file: File) {
  if (ACCEPTED_AVATAR_TYPES.includes(file.type) && file.size <= MAX_AVATAR_SIZE) return null;
  return "Escolha uma imagem JPG, PNG, WebP ou GIF de até 2 MB.";
}

export function normalizeUsername(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function getValidHttpUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function saveProfileDetails({
  user,
  profile,
  fullName,
  bio,
  avatarFile,
  username,
}: SaveProfileDetailsInput) {
  const normalizedName = fullName.trim();
  if (!normalizedName) throw new Error("Informe seu nome de exibição.");

  const supabase = getSupabaseBrowserClient();
  let avatarUrl = profile?.avatar_url ?? null;
  let uploadedAvatar: string | null = null;

  if (avatarFile) {
    const validationError = getAvatarFileValidationError(avatarFile);
    if (validationError) throw new Error(validationError);
    const convertedAvatar = await convertPhoto(avatarFile, MAX_AVATAR_SIZE);
    const extension = "webp";
    const filePath = `${user.id}/avatar-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("profile-media")
      .upload(filePath, convertedAvatar, {
        cacheControl: "3600",
        contentType: convertedAvatar.type,
        upsert: false,
      });
    if (uploadError) {
      console.error("[Looma] Falha no upload do avatar.", uploadError);
      throw new Error("Não foi possível enviar a sua foto. Tente novamente.");
    }

    uploadedAvatar = filePath;
    avatarUrl = `storage:profile-media/${filePath}`;
  }

  const update = {
    full_name: normalizedName,
    bio: bio.trim() || null,
    avatar_url: avatarUrl,
    ...(username === undefined ? {} : { username }),
  };

  const { data, error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", user.id)
    .select(
      "id, username, full_name, avatar_url, bio, created_at, onboarding_completed_at, experience_level",
    )
    .single();

  if (error) {
    if (uploadedAvatar) await supabase.storage.from("profile-media").remove([uploadedAvatar]);
    console.error("[Looma] Falha ao atualizar profiles.", {
      userId: user.id,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    if (error.code === "23505") throw new Error("Esse username já está em uso. Escolha outro.");
    throw new Error("Não foi possível salvar seu perfil. Tente novamente.");
  }

  if (uploadedAvatar && profile?.avatar_url?.startsWith("storage:profile-media/")) {
    await supabase.storage
      .from("profile-media")
      .remove([profile.avatar_url.slice("storage:profile-media/".length)]);
  }
  return data as Profile;
}

export async function saveUserSkillExperienceLevels(user: User, skills: EditableUserSkill[]) {
  const supabase = getSupabaseBrowserClient();

  const results = await Promise.all(
    skills.map(async (skill) => {
      const { data, error } = await supabase
        .from("user_skills")
        .update({ experience_level: skill.experienceLevel })
        .eq("id", skill.id)
        .eq("profile_id", user.id)
        .select("id, experience_level")
        .single();

      if (error) {
        console.error("[Looma] Falha ao atualizar a experiência da área.", {
          userId: user.id,
          skillId: skill.id,
          code: error.code,
          message: error.message,
        });
        throw new Error("Não foi possível salvar o nível de experiência das suas áreas.");
      }

      if (data.experience_level !== skill.experienceLevel) {
        throw new Error("O nível de experiência da área não foi confirmado pelo banco.");
      }
    }),
  );

  return results;
}

export async function replaceProfileLinks(user: User, links: EditableProfileLink[]) {
  const supabase = getSupabaseBrowserClient();
  const { error: deleteError } = await supabase
    .from("profile_links")
    .delete()
    .eq("profile_id", user.id);

  if (deleteError) {
    console.error("[Looma] Falha ao remover links anteriores do perfil.", {
      userId: user.id,
      code: deleteError.code,
      message: deleteError.message,
    });
    throw new Error("Não foi possível atualizar os links do seu perfil.");
  }

  if (!links.length) return;

  const { error: insertError } = await supabase.from("profile_links").insert(
    links.map((link) => ({
      profile_id: user.id,
      type: link.type,
      label: link.label,
      url: link.url,
    })),
  );

  if (insertError) {
    console.error("[Looma] Falha ao salvar links do perfil.", {
      userId: user.id,
      code: insertError.code,
      message: insertError.message,
    });
    throw new Error("Não foi possível atualizar os links do seu perfil.");
  }
}
