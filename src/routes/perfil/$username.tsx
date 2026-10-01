import { PostMedia } from "@/components/looma/PostMedia";
import type { PostMediaData } from "@/lib/media";
import { useEffect, useState } from "react";
import {
  BriefcaseBusiness,
  FileText,
  MoreHorizontal,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ProfileAvatar } from "@/components/looma/ProfileAvatar";
import { AdminVerifiedBadge } from "@/components/looma/AdminVerifiedBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  WorkspaceEmpty,
  WorkspaceError,
  WorkspaceSkeleton,
} from "@/components/looma/WorkspaceStates";
import { WorkspaceLayout } from "@/components/looma/WorkspaceLayout";
import { type Profile, useCurrentProfile } from "@/lib/profile";
import { normalizeUsername } from "@/lib/profile-editor";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getConnectionRows, type ConnectionRow } from "@/lib/activity-metrics";
import { createWorkProposal, MAX_PROPOSAL_MESSAGE_LENGTH } from "@/lib/proposals";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PublicPost = PostMediaData & {
  id: string;
  content: string;
  kind: "post" | "work";
  created_at: string;
};

type PublicProfile = Pick<
  Profile,
  "id" | "username" | "full_name" | "avatar_url" | "bio" | "is_admin"
>;

export const Route = createFileRoute("/perfil/$username")({ component: PublicProfilePage });

function PublicProfilePage() {
  const { username } = Route.useParams();
  const router = useRouter();
  const { user } = useCurrentProfile();
  const normalizedUsername = normalizeUsername(username);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [connection, setConnection] = useState<ConnectionRow | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isSendingConnection, setIsSendingConnection] = useState(false);
  const [proposalPost, setProposalPost] = useState<PublicPost | null>(null);
  const [proposalMessage, setProposalMessage] = useState("");
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [sendingProposal, setSendingProposal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isMissing, setIsMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let isCurrent = true;

    async function loadPublicProfile() {
      setIsLoading(true);
      setIsMissing(false);
      setError(null);
      setProfile(null);
      setPosts([]);
      setConnection(null);
      setConnectionError(null);

      if (!normalizedUsername) {
        if (isCurrent) {
          setIsMissing(true);
          setIsLoading(false);
        }
        return;
      }

      try {
        const supabase = getSupabaseBrowserClient();
        const profileResult = await supabase
          .from("profiles")
          .select("id, username, full_name, avatar_url, bio, is_admin")
          .eq("username", normalizedUsername)
          .maybeSingle();

        if (profileResult.error) {
          if (isCurrent) {
            setError(profileResult.error.message);
            setIsLoading(false);
          }
          return;
        }

        const publicProfile = profileResult.data as PublicProfile | null;
        if (!publicProfile) {
          if (isCurrent) {
            setIsMissing(true);
            setIsLoading(false);
          }
          return;
        }

        const postsResult = await supabase
          .from("posts")
          .select(
            "id, content, kind, created_at, media_path, media_type, media_size, media_duration",
          )
          .eq("author_id", publicProfile.id)
          .eq("status", "published")
          .order("created_at", { ascending: false });

        if (postsResult.error) {
          if (isCurrent) {
            setError(postsResult.error.message);
            setIsLoading(false);
          }
          return;
        }

        let currentConnection: ConnectionRow | null = null;
        let currentConnectionError: string | null = null;
        if (user && user.id !== publicProfile.id) {
          const connectionResult = await getConnectionRows(supabase, user.id);
          if (connectionResult.error) {
            currentConnectionError = connectionResult.error.message;
          } else {
            currentConnection =
              ((connectionResult.data ?? []) as ConnectionRow[]).find(
                (row) =>
                  (row.requester_id === user.id && row.addressee_id === publicProfile.id) ||
                  (row.requester_id === publicProfile.id && row.addressee_id === user.id),
              ) ?? null;
          }
        }

        if (isCurrent) {
          setProfile(publicProfile);
          setPosts((postsResult.data ?? []) as PublicPost[]);
          setConnection(currentConnection);
          setConnectionError(currentConnectionError);
          setIsLoading(false);
        }
      } catch (caught) {
        if (isCurrent) {
          setError(
            caught instanceof Error ? caught.message : "Não foi possível carregar este perfil.",
          );
          setIsLoading(false);
        }
      }
    }

    void loadPublicProfile();
    return () => {
      isCurrent = false;
    };
  }, [normalizedUsername, retryKey, user]);

  async function sendConnectionRequest() {
    if (!user || !profile || user.id === profile.id || connection || isSendingConnection) return;

    setIsSendingConnection(true);
    setConnectionError(null);
    try {
      const { data, error: requestError } = await getSupabaseBrowserClient()
        .from("connections")
        .insert({ requester_id: user.id, addressee_id: profile.id, status: "pending" })
        .select("id, requester_id, addressee_id, status, created_at")
        .single();

      if (requestError) {
        setConnectionError(requestError.message);
      } else {
        setConnection(data as ConnectionRow);
      }
    } catch (caught) {
      setConnectionError(
        caught instanceof Error ? caught.message : "Não foi possível enviar a solicitação.",
      );
    } finally {
      setIsSendingConnection(false);
    }
  }

  async function cancelConnectionRequest() {
    if (
      !user ||
      !connection ||
      connection.requester_id !== user.id ||
      connection.status !== "pending" ||
      isSendingConnection
    ) {
      return;
    }

    setIsSendingConnection(true);
    setConnectionError(null);
    try {
      const { error: cancelError } = await getSupabaseBrowserClient()
        .from("connections")
        .delete()
        .eq("id", connection.id)
        .eq("requester_id", user.id)
        .eq("status", "pending");

      if (cancelError) {
        setConnectionError(cancelError.message);
      } else {
        setConnection(null);
      }
    } catch (caught) {
      setConnectionError(
        caught instanceof Error ? caught.message : "Não foi possível cancelar a solicitação.",
      );
    } finally {
      setIsSendingConnection(false);
    }
  }

  function openProposalDialog(post: PublicPost) {
    if (!user || !profile || user.id === profile.id) return;
    setProposalPost(post);
    setProposalMessage("");
    setProposalError(null);
  }

  function handleProposalDialogChange(open: boolean) {
    if (!open && !sendingProposal) {
      setProposalPost(null);
      setProposalMessage("");
      setProposalError(null);
    }
  }

  async function sendProposal() {
    if (!user || !profile || !proposalPost || user.id === profile.id || sendingProposal) return;

    const message = proposalMessage.trim();
    if (!message) {
      setProposalError("Escreva uma mensagem para enviar sua proposta.");
      return;
    }

    setSendingProposal(true);
    setProposalError(null);
    try {
      const { error: proposalRequestError } = await createWorkProposal(getSupabaseBrowserClient(), {
        senderId: user.id,
        recipientId: profile.id,
        postId: proposalPost.id,
        postContent: proposalPost.content,
        message,
      });

      if (proposalRequestError) {
        setProposalError(proposalRequestError.message);
      } else {
        setProposalPost(null);
        setProposalMessage("");
      }
    } catch (caught) {
      setProposalError(
        caught instanceof Error ? caught.message : "Não foi possível enviar a proposta.",
      );
    } finally {
      setSendingProposal(false);
    }
  }

  const profileName = profile?.full_name?.trim() || `@${normalizedUsername}`;
  const profileHandle = profile?.username ? `@${profile.username}` : `@${normalizedUsername}`;
  const isOwnProfile = user?.id === profile?.id;
  const connectionLabel =
    connection?.status === "accepted"
      ? "Vocês já são conexões"
      : connection?.status === "pending" && connection.requester_id === user?.id
        ? "Solicitação enviada"
        : connection?.status === "pending"
          ? "Responder solicitação"
          : "Solicitação indisponível";

  if (isLoading) {
    return (
      <WorkspaceLayout title="Perfil" description="Carregando perfil público.">
        <WorkspaceSkeleton cards={3} />
      </WorkspaceLayout>
    );
  }

  if (error) {
    return (
      <WorkspaceLayout title="Perfil" description="Publicações e informações desta pessoa.">
        <WorkspaceError
          icon={UserRound}
          title="Não foi possível carregar este perfil"
          description={error}
          onRetry={() => setRetryKey((current) => current + 1)}
        />
      </WorkspaceLayout>
    );
  }

  if (isMissing || !profile) {
    return (
      <WorkspaceLayout title="Perfil" description="Publicações e informações desta pessoa.">
        <WorkspaceEmpty
          icon={UserRound}
          title="Perfil não encontrado"
          description="Esta pessoa ainda não tem um perfil público disponível na Looma."
        />
      </WorkspaceLayout>
    );
  }

  return (
    <WorkspaceLayout title={profileName} description={`Publicações de ${profileName} na Looma.`}>
      <section className="workspace-card workspace-person-card public-profile-identity">
        <ProfileAvatar
          className="workspace-avatar"
          fullName={profileName}
          avatarUrl={profile.avatar_url}
        />
        <div>
          <h2>
            {profileName}
            {profile.is_admin ? <AdminVerifiedBadge /> : null}
          </h2>
          <p>{profileHandle}</p>
          {profile.bio?.trim() ? <p>{profile.bio}</p> : null}
        </div>
        {user && !isOwnProfile ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="icon-action public-profile-actions-trigger"
                aria-label={`Opções para ${profileName}`}
              >
                <MoreHorizontal size={18} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="public-profile-actions-menu">
              {!connection ? (
                <DropdownMenuItem
                  disabled={isSendingConnection}
                  onSelect={() => void sendConnectionRequest()}
                >
                  <UserPlus size={16} aria-hidden="true" />
                  {isSendingConnection ? "Enviando solicitação…" : "Enviar solicitação de amizade"}
                </DropdownMenuItem>
              ) : connection.status === "pending" && connection.addressee_id === user.id ? (
                <DropdownMenuItem onSelect={() => void router.navigate({ to: "/conexoes" })}>
                  <UsersRound size={16} aria-hidden="true" /> Responder em Conexões
                </DropdownMenuItem>
              ) : connection.status === "pending" && connection.requester_id === user.id ? (
                <DropdownMenuItem
                  disabled={isSendingConnection}
                  onSelect={() => void cancelConnectionRequest()}
                >
                  <X size={16} aria-hidden="true" />
                  {isSendingConnection ? "Cancelando solicitação…" : "Cancelar solicitação"}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled>
                  <UsersRound size={16} aria-hidden="true" /> {connectionLabel}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </section>
      {connectionError ? (
        <p className="public-profile-connection-error" role="alert">
          {connectionError}
        </p>
      ) : null}
      {connection?.status === "pending" && connection.requester_id === user?.id ? (
        <p className="public-profile-connection-notice" role="status">
          Solicitação enviada. Esta pessoa poderá aceitá-la na página de Conexões.
        </p>
      ) : null}

      <section
        className="workspace-section public-profile-posts"
        aria-labelledby="public-profile-posts-title"
      >
        <header>
          <div>
            <h2 id="public-profile-posts-title">Publicações</h2>
            <p>O que {profileName} compartilhou na Looma.</p>
          </div>
          <FileText size={19} aria-hidden="true" />
        </header>

        {posts.length ? (
          <div className="workspace-card-list">
            {posts.map((post) => (
              <article className="workspace-card public-profile-post" key={post.id}>
                <time>
                  {new Intl.DateTimeFormat("pt-BR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(post.created_at))}
                </time>
                <p>{post.content}</p>
                <PostMedia path={post.media_path} type={post.media_type} />
                {post.kind === "work" ? (
                  <div className="feed-work-actions">
                    <span className="feed-work-badge">
                      <BriefcaseBusiness size={14} aria-hidden="true" /> Trabalho aberto
                    </span>
                    {user && !isOwnProfile ? (
                      <button
                        type="button"
                        className="feed-work-proposal"
                        onClick={() => openProposalDialog(post)}
                      >
                        Enviar proposta
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <WorkspaceEmpty
            icon={FileText}
            title="Ainda não há publicações"
            description={`${profileName} ainda não compartilhou nenhuma publicação pública.`}
          />
        )}
      </section>
      <Dialog open={proposalPost !== null} onOpenChange={handleProposalDialogChange}>
        <DialogContent showClose={!sendingProposal} className="post-proposal-dialog">
          <DialogHeader>
            <DialogTitle>Enviar proposta</DialogTitle>
            <DialogDescription>
              Escreva uma mensagem de até {MAX_PROPOSAL_MESSAGE_LENGTH.toLocaleString("pt-BR")}{" "}
              caracteres para este trabalho.
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="post-proposal-message"
            value={proposalMessage}
            onChange={(event) => setProposalMessage(event.target.value)}
            maxLength={MAX_PROPOSAL_MESSAGE_LENGTH}
            disabled={sendingProposal}
            placeholder="Conte como você pode ajudar neste trabalho"
            autoFocus
          />
          <p className="post-proposal-count">
            {proposalMessage.length}/{MAX_PROPOSAL_MESSAGE_LENGTH}
          </p>
          {proposalError ? (
            <p className="post-delete-error" role="alert">
              {proposalError}
            </p>
          ) : null}
          <DialogFooter className="post-delete-actions">
            <DialogClose asChild>
              <button type="button" className="post-delete-cancel" disabled={sendingProposal}>
                Cancelar
              </button>
            </DialogClose>
            <button
              type="button"
              className="post-delete-confirm"
              onClick={() => void sendProposal()}
              disabled={sendingProposal || !proposalMessage.trim()}
            >
              {sendingProposal ? "Enviando…" : "Enviar proposta"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspaceLayout>
  );
}
