import { MediaPicker } from "./MediaPicker";
import { PostMedia } from "./PostMedia";
import {
  uploadPostMedia,
  removePostMedia,
  type PreparedMedia,
  type PostMediaData,
} from "@/lib/media";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Compass,
  FileText,
  FilePenLine,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { LoomaSidebar } from "./Sidebar";
import { AdminVerifiedBadge } from "./AdminVerifiedBadge";
import { ProfileAvatar } from "./ProfileAvatar";
import { getProfileName, getProfileUsername, type Profile, useCurrentProfile } from "@/lib/profile";
import { useAdminAccess } from "@/lib/admin";
import { getConnectionRows, getPeerIds, type ConnectionRow } from "@/lib/activity-metrics";
import { createWorkProposal, MAX_PROPOSAL_MESSAGE_LENGTH } from "@/lib/proposals";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type FeedPost = PostMediaData & {
  id: string;
  author_id: string;
  content: string;
  kind: "post" | "work";
  likes_count: number;
  comments_count: number;
  created_at: string;
  updated_at: string;
};

type PendingFeedPost = {
  client_id: string;
  author_id: string;
  content: string;
  kind: "post" | "work";
  pending: true;
};

type FeedListItem = FeedPost | PendingFeedPost;

type FeedTab = "for-you" | "following";
type IntroStage = "logo" | "word" | "line" | "tagline";
type SearchPhase = "compact" | "opening-space" | "revealing" | "expanded" | "returning";
type SearchPosition = { left: number; top: number; width: number };
type PersonRecommendation = Pick<Profile, "avatar_url" | "full_name" | "username"> & {
  id: string;
  recommendation_reason: string;
};

type PeopleInMotionRow = {
  profile_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  recommendation_reason: string;
};

type HomeOpportunity = {
  id: string;
  title: string;
  description: string;
  category: string | null;
  type: string | null;
  work_mode: string | null;
};

type HomeInterest = {
  id: string;
  name: string;
};

type HomeSearchResult =
  | {
      id: string;
      type: "profile";
      title: string;
      detail: string;
      username: string;
    }
  | {
      id: string;
      type: "opportunity";
      title: string;
      detail: string;
    }
  | {
      id: string;
      type: "post";
      title: string;
      detail: string;
    };

const SEARCH_SPACE_TRANSITION_MS = 560;
const SEARCH_REVEAL_MS = 820;
const INTRO_BRAND_TEXT = "ooma";
const INTRO_TAGLINE = "we are building connections";
const INTRO_LOGO_MS = 640;
const INTRO_WORD_FADE_MS = 640;
const INTRO_LINE_DELAY_MS = 220;
const INTRO_LINE_MS = 940;
const INTRO_TAGLINE_HOLD_MS = 1080;
const POST_EXIT_ANIMATION_MS = 220;
const POST_PENDING_MINIMUM_MS = 1200;

function formatPostDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function searchKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function isPendingFeedPost(post: FeedListItem): post is PendingFeedPost {
  return "pending" in post;
}

export function LoomaLanding({
  showSplash,
  onSplashComplete,
}: {
  showSplash: boolean;
  onSplashComplete: () => void;
}) {
  const [feedReady, setFeedReady] = useState(() => !showSplash);
  const [introVisible, setIntroVisible] = useState(() => !showSplash);
  const [introStage, setIntroStage] = useState<IntroStage>("logo");
  const [introSequenceDone, setIntroSequenceDone] = useState(() => !showSplash);
  const [media, setMedia] = useState<PreparedMedia | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaKey, setMediaKey] = useState(0);
  const [message, setMessage] = useState("");
  const [postKind, setPostKind] = useState<FeedPost["kind"]>("post");
  const [feedTab, setFeedTab] = useState<FeedTab>("for-you");
  const [posts, setPosts] = useState<FeedListItem[]>([]);
  const [postProfiles, setPostProfiles] = useState<Record<string, Profile>>({});
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PersonRecommendation[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<HomeOpportunity[]>([]);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(true);
  const [opportunitiesError, setOpportunitiesError] = useState<string | null>(null);
  const [interests, setInterests] = useState<HomeInterest[]>([]);
  const [interestsLoading, setInterestsLoading] = useState(true);
  const [interestsError, setInterestsError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [activePostMenuId, setActivePostMenuId] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostContent, setEditingPostContent] = useState("");
  const [savingPostId, setSavingPostId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [postPendingDeletion, setPostPendingDeletion] = useState<FeedPost | null>(null);
  const [removingPostId, setRemovingPostId] = useState<string | null>(null);
  const [recentlyAddedPostId, setRecentlyAddedPostId] = useState<string | null>(null);
  const [postActionError, setPostActionError] = useState<string | null>(null);
  const [proposalPost, setProposalPost] = useState<FeedPost | null>(null);
  const [proposalMessage, setProposalMessage] = useState("");
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [sendingProposal, setSendingProposal] = useState(false);
  const [searchPhase, setSearchPhase] = useState<SearchPhase>("compact");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPosition, setSearchPosition] = useState<SearchPosition | null>(null);
  const [searchInversion, setSearchInversion] = useState<SearchPosition | null>(null);
  const feedStageRef = useRef<HTMLElement>(null);
  const compactSearchAnchorRef = useRef<HTMLDivElement>(null);
  const expandedSearchSlotRef = useRef<HTMLDivElement>(null);
  const searchOverlayRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const splashWasActiveRef = useRef(showSplash);
  const postRemovalTimerRef = useRef<number | null>(null);
  const { profile, user, isLoading: isProfileLoading } = useCurrentProfile();
  const { isAdmin } = useAdminAccess(user);
  const displayName = getProfileName(profile, user);
  const username = getProfileUsername(profile, user);
  const firstName = user ? displayName.trim().split(/\s+/)[0] || "você" : "você";
  const searchResults = useMemo(() => {
    const query = searchKey(searchQuery);
    if (query.length < 2) return [];

    const matches = (value: string | null | undefined) => searchKey(value ?? "").includes(query);
    const results: HomeSearchResult[] = [];
    const seenProfileIds = new Set<string>();

    for (const candidate of [...Object.values(postProfiles), ...suggestions]) {
      if (!candidate.username || seenProfileIds.has(candidate.id)) continue;
      if (!matches(candidate.full_name) && !matches(candidate.username)) continue;
      seenProfileIds.add(candidate.id);
      results.push({
        id: candidate.id,
        type: "profile",
        title: candidate.full_name?.trim() || `@${candidate.username}`,
        detail: `@${candidate.username.replace(/^@/, "")}`,
        username: candidate.username.replace(/^@/, ""),
      });
    }

    for (const opportunity of opportunities) {
      if (!matches(opportunity.title) && !matches(opportunity.description)) continue;
      results.push({
        id: opportunity.id,
        type: "opportunity",
        title: opportunity.title,
        detail: opportunity.category || "Oportunidade",
      });
    }

    for (const post of posts) {
      if (isPendingFeedPost(post) || !matches(post.content)) continue;
      const author = postProfiles[post.author_id];
      results.push({
        id: post.id,
        type: "post",
        title: author?.full_name?.trim() || "Publicação",
        detail: post.content,
      });
    }

    return results.slice(0, 8);
  }, [opportunities, postProfiles, posts, searchQuery, suggestions]);

  useEffect(() => {
    if (showSplash && !splashWasActiveRef.current) {
      setFeedReady(false);
      setIntroVisible(false);
    }
    splashWasActiveRef.current = showSplash;
  }, [showSplash]);

  useEffect(() => {
    if (!showSplash) {
      setIntroVisible(true);
      setIntroStage("tagline");
      setIntroSequenceDone(true);
      return;
    }

    setIntroVisible(false);
    setIntroStage("logo");
    setIntroSequenceDone(false);

    const timers: number[] = [];
    const lineStartsAt = INTRO_LOGO_MS + INTRO_WORD_FADE_MS + INTRO_LINE_DELAY_MS;
    const taglineStartsAt = lineStartsAt + INTRO_LINE_MS;
    const sequenceEndsAt = taglineStartsAt + INTRO_TAGLINE_HOLD_MS;

    timers.push(window.setTimeout(() => setIntroVisible(true), 40));
    timers.push(window.setTimeout(() => setIntroStage("word"), INTRO_LOGO_MS));
    timers.push(window.setTimeout(() => setIntroStage("line"), lineStartsAt));
    timers.push(window.setTimeout(() => setIntroStage("tagline"), taglineStartsAt));
    timers.push(window.setTimeout(() => setIntroSequenceDone(true), sequenceEndsAt));

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [showSplash]);

  useEffect(() => {
    if (!showSplash || !introSequenceDone) return;
    if (isProfileLoading || postsLoading || suggestionsLoading) return;

    setFeedReady(true);
    onSplashComplete();
  }, [
    isProfileLoading,
    introSequenceDone,
    onSplashComplete,
    postsLoading,
    showSplash,
    suggestionsLoading,
  ]);

  const loadFeed = useCallback(async () => {
    setPostsLoading(true);
    setPostsError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const userId = user?.id;
      let acceptedPeerIds: string[] = [];

      if (feedTab === "following") {
        if (!userId) {
          setPosts([]);
          setPostProfiles({});
          return;
        }
        const connectionResult = await getConnectionRows(supabase, userId);
        if (connectionResult.error) {
          setPostsError(connectionResult.error.message);
          return;
        }
        acceptedPeerIds = [
          ...getPeerIds((connectionResult.data ?? []) as ConnectionRow[], userId, ["accepted"]),
        ];
        if (!acceptedPeerIds.length) {
          setPosts([]);
          setPostProfiles({});
          return;
        }
      }

      let query = supabase
        .from("posts")
        .select(
          "id, author_id, content, kind, likes_count, comments_count, created_at, updated_at, media_path, media_type, media_size, media_duration",
        )
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(30);
      if (feedTab === "following") query = query.in("author_id", acceptedPeerIds);

      const postResult = await query;
      if (postResult.error) {
        setPostsError(postResult.error.message);
        return;
      }

      const rows = (postResult.data ?? []) as FeedPost[];
      const authorIds = [...new Set(rows.map((post) => post.author_id))];
      if (!authorIds.length) {
        setPosts([]);
        setPostProfiles({});
        return;
      }

      const profileResult = await supabase
        .from("profiles")
        .select("id, username, full_name, avatar_url, bio, created_at, is_admin")
        .in("id", authorIds);
      if (profileResult.error) {
        setPostsError(profileResult.error.message);
        return;
      }

      setPosts(rows);
      setPostProfiles(
        Object.fromEntries(
          ((profileResult.data ?? []) as Profile[]).map((item) => [item.id, item]),
        ),
      );
    } catch (caught) {
      setPostsError(caught instanceof Error ? caught.message : "Não foi possível carregar o feed.");
    } finally {
      setPostsLoading(false);
    }
  }, [feedTab, user?.id]);

  const loadSuggestions = useCallback(async () => {
    if (!user?.id) {
      setSuggestions([]);
      setSuggestionsError(null);
      setSuggestionsLoading(false);
      return;
    }

    setSuggestionsLoading(true);
    setSuggestionsError(null);
    try {
      const recommendationResult = await getSupabaseBrowserClient().rpc("get_people_in_motion", {
        result_limit: 3,
      });
      if (recommendationResult.error) {
        setSuggestionsError(recommendationResult.error.message);
      } else {
        const recommendationRows = (recommendationResult.data ?? []) as PeopleInMotionRow[];
        setSuggestions(
          recommendationRows.map((item) => ({
            id: item.profile_id,
            full_name: item.full_name,
            username: item.username,
            avatar_url: item.avatar_url,
            recommendation_reason: item.recommendation_reason,
          })),
        );
      }
    } catch (caught) {
      setSuggestionsError(
        caught instanceof Error ? caught.message : "Não foi possível carregar as recomendações.",
      );
    } finally {
      setSuggestionsLoading(false);
    }
  }, [user?.id]);

  const loadDiscovery = useCallback(async () => {
    setOpportunitiesLoading(true);
    setInterestsLoading(true);
    setOpportunitiesError(null);
    setInterestsError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const [opportunitiesResult, interestsResult] = await Promise.all([
        supabase
          .from("opportunities")
          .select("id, title, description, category, type, work_mode")
          .order("created_at", { ascending: false })
          .limit(3),
        supabase.from("skill_tags").select("id, name").order("name").limit(8),
      ]);

      if (opportunitiesResult.error) {
        setOpportunities([]);
        setOpportunitiesError(opportunitiesResult.error.message);
      } else {
        setOpportunities((opportunitiesResult.data ?? []) as HomeOpportunity[]);
      }

      if (interestsResult.error) {
        setInterests([]);
        setInterestsError(interestsResult.error.message);
      } else {
        setInterests((interestsResult.data ?? []) as HomeInterest[]);
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Não foi possível carregar as descobertas.";
      setOpportunities([]);
      setInterests([]);
      setOpportunitiesError(message);
      setInterestsError(message);
    } finally {
      setOpportunitiesLoading(false);
      setInterestsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);
  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);
  useEffect(() => {
    void loadDiscovery();
  }, [loadDiscovery]);

  useEffect(
    () => () => {
      if (postRemovalTimerRef.current !== null) window.clearTimeout(postRemovalTimerRef.current);
    },
    [],
  );

  const toStagePosition = (rect: DOMRect): SearchPosition | null => {
    const stage = feedStageRef.current;
    const stageRect = stage?.getBoundingClientRect();
    if (!stage || !stageRect) return null;
    return {
      left: rect.left - stageRect.left + stage.scrollLeft,
      top: rect.top - stageRect.top + stage.scrollTop,
      width: rect.width,
    };
  };

  useEffect(() => {
    if (searchPhase !== "compact") return;
    const syncCompactPosition = () => {
      const anchor = compactSearchAnchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const nextPosition = toStagePosition(anchor);
      if (nextPosition) setSearchPosition(nextPosition);
    };
    const initialFrame = window.requestAnimationFrame(syncCompactPosition);
    window.addEventListener("resize", syncCompactPosition);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.removeEventListener("resize", syncCompactPosition);
    };
  }, [searchPhase]);

  useEffect(() => {
    if (searchPhase !== "opening-space") return;
    const revealTimer = window.setTimeout(() => {
      const target = expandedSearchSlotRef.current?.getBoundingClientRect();
      if (!target) return setSearchPhase("expanded");
      const targetPosition = toStagePosition(target);
      if (!targetPosition) return setSearchPhase("expanded");
      setSearchPosition(targetPosition);
      setSearchInversion(null);
      setSearchPhase("revealing");
    }, SEARCH_SPACE_TRANSITION_MS);
    return () => window.clearTimeout(revealTimer);
  }, [searchPhase]);

  useEffect(() => {
    if (searchPhase !== "revealing") return;
    const revealTimer = window.setTimeout(() => setSearchPhase("expanded"), SEARCH_REVEAL_MS);
    return () => window.clearTimeout(revealTimer);
  }, [searchPhase]);

  useEffect(() => {
    if (searchPhase !== "returning" || !searchInversion) return;
    const playFrame = window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => setSearchInversion(null)),
    );
    return () => {
      window.cancelAnimationFrame(playFrame);
    };
  }, [searchInversion, searchPhase]);

  useEffect(() => {
    if (searchPhase !== "returning") return;
    const finishTimer = window.setTimeout(
      () => setSearchPhase("compact"),
      SEARCH_SPACE_TRANSITION_MS + 34,
    );
    return () => window.clearTimeout(finishTimer);
  }, [searchPhase]);

  async function publish() {
    const content = message.trim();
    if (!content || publishing || mediaBusy) return;
    if (!user) {
      setComposerError("Entre com sua conta para publicar.");
      return;
    }

    const pendingPost: PendingFeedPost = {
      client_id: crypto.randomUUID(),
      author_id: user.id,
      content,
      kind: postKind,
      pending: true,
    };

    setPosts((current) => [pendingPost, ...current]);
    setPublishing(true);
    setComposerError(null);
    const pendingMinimumTimer = new Promise<void>((resolve) => {
      window.setTimeout(resolve, POST_PENDING_MINIMUM_MS);
    });
    let uploadedPath: string | null = null;
    try {
      const attachment = await uploadPostMedia(user.id, media);
      uploadedPath = attachment.media_path;
      const result = await getSupabaseBrowserClient()
        .from("posts")
        .insert({ author_id: user.id, content, kind: postKind, status: "published", ...attachment })
        .select(
          "id, author_id, content, kind, likes_count, comments_count, created_at, updated_at, media_path, media_type, media_size, media_duration",
        )
        .single();
      if (result.error || !result.data) {
        await removePostMedia(uploadedPath);
        uploadedPath = null;
        setPosts((current) =>
          current.filter(
            (post) => !isPendingFeedPost(post) || post.client_id !== pendingPost.client_id,
          ),
        );
        setComposerError(result.error?.message ?? "Não foi possível publicar agora.");
        return;
      }

      uploadedPath = null;
      setMedia(null);
      setMediaKey((key) => key + 1);
      const [confirmedResult] = await Promise.all([Promise.resolve(result), pendingMinimumTimer]);
      const newPost = confirmedResult.data as FeedPost;
      setMessage("");
      setPostKind("post");
      setPostsError(null);
      setPosts((current) =>
        current.map((post) =>
          isPendingFeedPost(post) && post.client_id === pendingPost.client_id ? newPost : post,
        ),
      );
      setRecentlyAddedPostId(newPost.id);
      setFeedTab("for-you");
    } catch (caught) {
      await removePostMedia(uploadedPath);
      setPosts((current) =>
        current.filter(
          (post) => !isPendingFeedPost(post) || post.client_id !== pendingPost.client_id,
        ),
      );
      setComposerError(
        caught instanceof Error ? caught.message : "Não foi possível publicar agora.",
      );
    } finally {
      setPublishing(false);
    }
  }

  function startPostEdit(post: FeedPost) {
    setActivePostMenuId(null);
    setPostActionError(null);
    setEditingPostId(post.id);
    setEditingPostContent(post.content);
  }

  function cancelPostEdit() {
    setEditingPostId(null);
    setEditingPostContent("");
    setPostActionError(null);
  }

  function requestPostDeletion(post: FeedPost) {
    setActivePostMenuId(null);
    setPostActionError(null);
    setPostPendingDeletion(post);
  }

  function handlePostDeletionDialogChange(open: boolean) {
    if (!open && !deletingPostId) {
      setPostPendingDeletion(null);
      setPostActionError(null);
    }
  }

  async function savePostEdit(post: FeedPost) {
    const content = editingPostContent.trim();
    if (!user || user.id !== post.author_id || savingPostId) return;
    if (!content) {
      setPostActionError("A publicação não pode ficar vazia.");
      return;
    }

    setSavingPostId(post.id);
    setPostActionError(null);
    try {
      const result = await getSupabaseBrowserClient()
        .from("posts")
        .update({ content, updated_at: new Date().toISOString() })
        .eq("id", post.id)
        .eq("author_id", user.id)
        .select(
          "id, author_id, content, kind, likes_count, comments_count, created_at, updated_at, media_path, media_type, media_size, media_duration",
        )
        .single();

      if (result.error || !result.data) {
        setPostActionError(result.error?.message ?? "Não foi possível salvar a edição.");
        return;
      }

      const updatedPost = result.data as FeedPost;
      setPosts((current) =>
        current.map((item) =>
          !isPendingFeedPost(item) && item.id === updatedPost.id ? updatedPost : item,
        ),
      );
      setEditingPostId(null);
      setEditingPostContent("");
    } catch (caught) {
      setPostActionError(
        caught instanceof Error ? caught.message : "Não foi possível salvar a edição.",
      );
    } finally {
      setSavingPostId(null);
    }
  }

  async function deletePost(post: FeedPost) {
    if (!user || user.id !== post.author_id || deletingPostId) return;

    setDeletingPostId(post.id);
    setPostActionError(null);
    try {
      const result = await getSupabaseBrowserClient()
        .from("posts")
        .delete()
        .eq("id", post.id)
        .eq("author_id", user.id);

      if (result.error) {
        setPostActionError(result.error.message);
        setDeletingPostId(null);
        return;
      }

      await removePostMedia(post.media_path);
      setRemovingPostId(post.id);
      setPostPendingDeletion(null);
      postRemovalTimerRef.current = window.setTimeout(() => {
        setPosts((current) =>
          current.filter((item) => isPendingFeedPost(item) || item.id !== post.id),
        );
        setRemovingPostId(null);
        setDeletingPostId(null);
        postRemovalTimerRef.current = null;
      }, POST_EXIT_ANIMATION_MS);
    } catch (caught) {
      setPostActionError(
        caught instanceof Error ? caught.message : "Não foi possível excluir a publicação.",
      );
      setDeletingPostId(null);
    }
  }

  async function requestConnection(addresseeId: string) {
    if (!user || connectingId) return;
    setConnectingId(addresseeId);
    setSuggestionsError(null);
    try {
      const result = await getSupabaseBrowserClient()
        .from("connections")
        .insert({ requester_id: user.id, addressee_id: addresseeId, status: "pending" });
      if (result.error) setSuggestionsError(result.error.message);
      else setSuggestions((current) => current.filter((item) => item.id !== addresseeId));
    } catch (caught) {
      setSuggestionsError(
        caught instanceof Error ? caught.message : "Não foi possível enviar a solicitação.",
      );
    } finally {
      setConnectingId(null);
    }
  }

  function openProposalDialog(post: FeedPost) {
    if (!user || user.id === post.author_id) return;
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
    if (!user || !proposalPost || proposalPost.author_id === user.id || sendingProposal) return;

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
        recipientId: proposalPost.author_id,
        postId: proposalPost.id,
        postContent: proposalPost.content,
        message,
      });

      if (proposalRequestError) {
        setProposalError(proposalRequestError.message);
      } else {
        setProposalPost(null);
        setProposalMessage("");
        setPostActionError(null);
      }
    } catch (caught) {
      setProposalError(
        caught instanceof Error ? caught.message : "Não foi possível enviar a proposta.",
      );
    } finally {
      setSendingProposal(false);
    }
  }

  const openSearch = () => {
    if (searchPhase === "compact") setSearchPhase("opening-space");
  };
  const closeSearch = () => {
    if (searchPhase === "compact" || searchPhase === "returning") return;
    const source = searchOverlayRef.current?.getBoundingClientRect();
    const target = compactSearchAnchorRef.current?.getBoundingClientRect();
    const targetPosition = target ? toStagePosition(target) : null;

    if (!source || !target || !targetPosition) {
      setSearchInversion(null);
      setSearchPhase("compact");
      return;
    }

    setSearchPosition(targetPosition);
    setSearchInversion({
      left: source.left - target.left,
      top: source.top - target.top,
      width: source.width / target.width,
    });
    setSearchPhase("returning");
  };
  const isSearchSpaceOpen = searchPhase !== "compact" && searchPhase !== "returning";
  const focusComposer = () => composerInputRef.current?.focus();
  const focusPostFromSearch = (postId: string) => {
    const post = document.querySelector<HTMLElement>(`[data-feed-post-id="${postId}"]`);
    post?.scrollIntoView({ behavior: "smooth", block: "center" });
    closeSearch();
  };
  const hasSearchQuery = searchQuery.trim().length > 0;

  return (
    <main
      className={`looma-transition ${introVisible ? "intro-visible" : ""} intro-stage-${introStage} ${feedReady ? "feed-ready" : ""}`}
    >
      <section className="brand-intro" aria-label={`Looma, ${INTRO_TAGLINE}`}>
        <div className="intro-lockup">
          <span className="looma-logo-mark intro-logo" role="img" aria-label="Looma" />
          <span className="intro-brand-copy">
            <span className="intro-brand-name" aria-hidden="true">
              <span className="intro-brand-reserve">{INTRO_BRAND_TEXT}</span>
              <span className="intro-brand-typed">{INTRO_BRAND_TEXT}</span>
              <span className="intro-brand-fallback">{INTRO_BRAND_TEXT}</span>
            </span>
            <span className="intro-underline" />
          </span>
          <span className="intro-tagline-clip">
            <span className="intro-tagline">{INTRO_TAGLINE}</span>
          </span>
        </div>
      </section>

      <section ref={feedStageRef} className="feed-stage" aria-hidden={!feedReady}>
        <LoomaSidebar />
        <div className="home-shell">
          <div className="home-main-scroll">
            <header className="home-command-header home-topbar">
              <div className="home-welcome">
                <p className="home-welcome-label">Seu espaço na Looma</p>
                <h1>Bom dia, {firstName}</h1>
                <p>O que você quer construir hoje?</p>
              </div>
              <div
                className={`aside-search-compact home-search-compact home-header-search ${searchPhase !== "compact" && searchPhase !== "returning" ? "is-collapsed" : ""}`}
              >
                <div
                  ref={compactSearchAnchorRef}
                  className="aside-search-anchor"
                  aria-hidden="true"
                />
              </div>
            </header>
            <div
              ref={expandedSearchSlotRef}
              className={`feed-search-expand-slot ${isSearchSpaceOpen ? "is-expanded" : ""}`}
            />

            <section className="home-feed-stream" aria-label="Atualizações">
              <section className="feed-column home-feed-panel" aria-label="Feed da Looma">
                <header className="home-panel-heading home-feed-heading">
                  <div className="feed-tabs" role="tablist" aria-label="Tipo de feed">
                    <button
                      type="button"
                      className={feedTab === "for-you" ? "active" : ""}
                      onClick={() => setFeedTab("for-you")}
                      role="tab"
                      aria-selected={feedTab === "for-you"}
                    >
                      Para você
                    </button>
                    <button
                      type="button"
                      className={feedTab === "following" ? "active" : ""}
                      onClick={() => setFeedTab("following")}
                      role="tab"
                      aria-selected={feedTab === "following"}
                    >
                      Seguindo
                    </button>
                  </div>
                </header>
                <section className="post-list" aria-label="Publicações recentes">
                  {postActionError ? (
                    <p className="home-inline-error post-action-error" role="alert">
                      {postActionError}
                    </p>
                  ) : null}
                  {postsLoading ? (
                    <div className="home-feed-skeleton" aria-label="Carregando publicações">
                      <i />
                      <i />
                      <i />
                    </div>
                  ) : postsError ? (
                    <p className="home-feed-state" role="alert">
                      Não foi possível carregar as publicações: {postsError}
                    </p>
                  ) : posts.length === 0 ? (
                    <section className="home-feed-empty">
                      <div>
                        <p className="home-feed-empty-eyebrow">
                          {feedTab === "following" ? "Sua rede" : "Seu espaço está pronto"}
                        </p>
                        <h2>
                          {feedTab === "following"
                            ? "Comece pelas suas próximas conexões"
                            : "Compartilhe o que está acontecendo"}
                        </h2>
                        <p>
                          {feedTab === "following"
                            ? "Conecte-se com pessoas da sua área para acompanhar projetos, ideias e oportunidades por aqui."
                            : "Publique uma ideia, explore oportunidades ou deixe seu portfólio pronto para novas conversas."}
                        </p>
                      </div>
                      <div className="home-empty-actions">
                        {feedTab === "for-you" ? (
                          <button
                            type="button"
                            className="home-empty-primary"
                            onClick={focusComposer}
                          >
                            <FilePenLine size={16} aria-hidden="true" /> Fazer uma publicação
                          </button>
                        ) : null}
                        <Link to="/oportunidades" className="home-empty-link">
                          <BriefcaseBusiness size={16} aria-hidden="true" /> Explorar oportunidades
                        </Link>
                        <Link to="/conexoes" className="home-empty-link">
                          <UserRound size={16} aria-hidden="true" /> Conhecer pessoas
                        </Link>
                        <Link to="/perfil" className="home-empty-link">
                          <Pencil size={16} aria-hidden="true" /> Completar portfólio
                        </Link>
                      </div>
                    </section>
                  ) : (
                    posts.map((post) => {
                      const isPending = isPendingFeedPost(post);
                      const author = postProfiles[post.author_id];
                      const isAuthor = !isPending && user?.id === post.author_id;
                      const isEditing = !isPending && editingPostId === post.id;
                      const isEntering = !isPending && recentlyAddedPostId === post.id;
                      const isRemoving = !isPending && removingPostId === post.id;
                      const authorName =
                        author?.full_name?.trim() ||
                        (isAuthor || isPending ? displayName : "Usuário");
                      const authorUsername = author?.username
                        ? `@${author.username.replace(/^@/, "")}`
                        : (isAuthor || isPending) && username.startsWith("@")
                          ? username
                          : "";
                      const isAdminAuthor =
                        author?.is_admin === true ||
                        ((isAuthor || isPending) && (profile?.is_admin === true || isAdmin));
                      const postKey = isPending ? `pending-${post.client_id}` : post.id;
                      return (
                        <article
                          className={`feed-post ${isPending ? "is-pending" : ""} ${isEntering ? "is-entering" : ""} ${isRemoving ? "is-removing" : ""}`}
                          key={postKey}
                          data-feed-post-id={isPending ? undefined : post.id}
                          onAnimationEnd={(event) => {
                            if (event.animationName === "feed-post-enter" && isEntering)
                              setRecentlyAddedPostId(null);
                          }}
                        >
                          <ProfileAvatar
                            className="avatar"
                            fullName={authorName}
                            avatarUrl={
                              author?.avatar_url ??
                              (isAuthor || isPending ? (profile?.avatar_url ?? null) : null)
                            }
                          />
                          <div className="post-body">
                            <div className="post-meta">
                              {author?.username ? (
                                <Link
                                  className="post-author-link"
                                  to="/perfil/$username"
                                  params={{ username: author.username.replace(/^@/, "") }}
                                >
                                  {authorName}
                                  {isAdminAuthor ? <AdminVerifiedBadge /> : null}
                                </Link>
                              ) : (
                                <strong>
                                  {authorName}
                                  {isAdminAuthor ? <AdminVerifiedBadge /> : null}
                                </strong>
                              )}
                              <span>
                                {isPending ? (
                                  "Enviando…"
                                ) : (
                                  <>
                                    {authorUsername ? `${authorUsername} · ` : ""}
                                    {formatPostDate(post.created_at)}
                                  </>
                                )}
                              </span>
                              {isAuthor ? (
                                <div className="post-menu-wrap">
                                  <button
                                    type="button"
                                    className="post-menu-trigger"
                                    aria-label="Opções da publicação"
                                    aria-expanded={activePostMenuId === post.id}
                                    aria-controls={`post-menu-${post.id}`}
                                    onClick={() =>
                                      setActivePostMenuId((current) =>
                                        current === post.id ? null : post.id,
                                      )
                                    }
                                  >
                                    <MoreHorizontal size={18} aria-hidden="true" />
                                  </button>
                                  {activePostMenuId === post.id ? (
                                    <div
                                      id={`post-menu-${post.id}`}
                                      className="post-menu"
                                      role="menu"
                                    >
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => startPostEdit(post)}
                                        disabled={deletingPostId === post.id}
                                      >
                                        <Pencil size={15} aria-hidden="true" /> Editar
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="post-menu-delete"
                                        onClick={() => requestPostDeletion(post)}
                                        disabled={deletingPostId === post.id}
                                      >
                                        <Trash2 size={15} aria-hidden="true" />{" "}
                                        {deletingPostId === post.id ? "Excluindo…" : "Excluir"}
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            {isEditing ? (
                              <div className="post-edit-form">
                                <textarea
                                  value={editingPostContent}
                                  onChange={(event) => setEditingPostContent(event.target.value)}
                                  maxLength={300}
                                  aria-label="Editar publicação"
                                  autoFocus
                                />
                                <div className="post-edit-actions">
                                  <button
                                    type="button"
                                    className="post-edit-cancel"
                                    onClick={cancelPostEdit}
                                    disabled={savingPostId === post.id}
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    type="button"
                                    className="post-edit-save"
                                    onClick={() => void savePostEdit(post)}
                                    disabled={
                                      savingPostId === post.id || !editingPostContent.trim()
                                    }
                                  >
                                    {savingPostId === post.id ? "Salvando…" : "Salvar"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p>{post.content}</p>
                            )}
                            {!isPending && (
                              <PostMedia path={post.media_path} type={post.media_type} />
                            )}
                            {!isPending && post.kind === "work" ? (
                              <div className="feed-work-actions">
                                <span className="feed-work-badge">
                                  <BriefcaseBusiness size={14} aria-hidden="true" /> Trabalho aberto
                                </span>
                                {!isAuthor ? (
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
                          </div>
                        </article>
                      );
                    })
                  )}
                </section>
              </section>
            </section>
          </div>

          <aside className="home-context-rail" aria-label="Atalhos e descobertas">
            <div className="home-discovery-board">
              <section
                className="home-discovery-section home-opportunities-section"
                aria-labelledby="home-opportunities-title"
              >
                <header className="home-section-header">
                  <div>
                    <p className="home-section-kicker">Descubra possibilidades</p>
                    <h2 id="home-opportunities-title">Oportunidades para você</h2>
                    <p>Vagas, projetos e pedidos publicados pela comunidade.</p>
                  </div>
                  <Link to="/oportunidades">Ver todas</Link>
                </header>
                {opportunitiesLoading ? (
                  <div className="home-discovery-skeleton" aria-label="Carregando oportunidades">
                    <i />
                    <i />
                    <i />
                  </div>
                ) : opportunitiesError ? (
                  <section className="home-discovery-empty" role="alert">
                    <p>Não foi possível carregar oportunidades: {opportunitiesError}</p>
                    <Link to="/oportunidades">Tentar na página de oportunidades</Link>
                  </section>
                ) : opportunities.length ? (
                  <div className="home-opportunity-grid">
                    {opportunities.map((opportunity) => (
                      <article className="home-opportunity-card" key={opportunity.id}>
                        <div className="home-opportunity-card-top">
                          <BriefcaseBusiness size={18} aria-hidden="true" />
                          {opportunity.category ? <span>{opportunity.category}</span> : null}
                        </div>
                        <h3>{opportunity.title}</h3>
                        <p>
                          {opportunity.description.length > 150
                            ? `${opportunity.description.slice(0, 150)}…`
                            : opportunity.description}
                        </p>
                        <div className="home-opportunity-meta">
                          {opportunity.type ? <span>{opportunity.type}</span> : null}
                          {opportunity.work_mode ? <span>{opportunity.work_mode}</span> : null}
                        </div>
                        <Link to="/oportunidades">Ver oportunidade</Link>
                      </article>
                    ))}
                  </div>
                ) : (
                  <section className="home-discovery-empty">
                    <div>
                      <h3>As próximas oportunidades começam por aqui.</h3>
                      <p>Quando a comunidade publicar algo novo, você verá nesta área.</p>
                    </div>
                    <Link to="/conexoes">Conhecer pessoas para se conectar</Link>
                  </section>
                )}
              </section>

              <section className="home-discovery-section" aria-labelledby="home-people-title">
                <header className="home-section-header">
                  <div>
                    <p className="home-section-kicker">Sua rede</p>
                    <h2 id="home-people-title">Pessoas para conhecer</h2>
                    <p>Profissionais que podem somar ao que você está construindo.</p>
                  </div>
                  <Link to="/conexoes">Abrir conexões</Link>
                </header>
                {suggestionsLoading ? (
                  <div
                    className="home-discovery-skeleton"
                    aria-label="Carregando pessoas recomendadas"
                  >
                    <i />
                    <i />
                    <i />
                  </div>
                ) : suggestionsError ? (
                  <section className="home-discovery-empty" role="alert">
                    <p>Não foi possível carregar pessoas recomendadas: {suggestionsError}</p>
                    <Link to="/conexoes">Ver conexões</Link>
                  </section>
                ) : suggestions.length ? (
                  <div className="home-people-grid">
                    {suggestions.map((suggestion) => (
                      <article className="home-person-card" key={suggestion.id}>
                        <ProfileAvatar
                          className="avatar"
                          fullName={suggestion.full_name || "Usuário"}
                          avatarUrl={suggestion.avatar_url}
                        />
                        <div>
                          {suggestion.username ? (
                            <Link
                              className="home-person-profile-link"
                              to="/perfil/$username"
                              params={{ username: suggestion.username.replace(/^@/, "") }}
                            >
                              <h3>{suggestion.full_name?.trim() || "Usuário"}</h3>
                            </Link>
                          ) : (
                            <h3>{suggestion.full_name?.trim() || "Usuário"}</h3>
                          )}
                          {suggestion.username ? (
                            <p>@{suggestion.username.replace(/^@/, "")}</p>
                          ) : null}
                          <small>{suggestion.recommendation_reason}</small>
                        </div>
                        <button
                          type="button"
                          disabled={connectingId === suggestion.id}
                          onClick={() => void requestConnection(suggestion.id)}
                        >
                          {connectingId === suggestion.id ? "Enviando…" : "Conectar"}
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <section className="home-discovery-empty">
                    <div>
                      <h3>Amplie sua rede com intenção.</h3>
                      <p>
                        Conexões recomendadas aparecerão aqui quando a sua conta estiver pronta.
                      </p>
                    </div>
                    <Link to="/conexoes">Explorar conexões</Link>
                  </section>
                )}
              </section>

              <section
                className="home-discovery-section home-projects-section"
                aria-labelledby="home-projects-title"
              >
                <header className="home-section-header">
                  <div>
                    <p className="home-section-kicker">Em construção</p>
                    <h2 id="home-projects-title">Projetos e portfólios para explorar</h2>
                    <p>Um espaço para descobrir trabalhos que a comunidade decidir compartilhar.</p>
                  </div>
                  <Link to="/perfil">Meu portfólio</Link>
                </header>
                <section className="home-discovery-empty home-projects-empty">
                  <LayoutGrid size={22} aria-hidden="true" />
                  <div>
                    <h3>Seu trabalho pode abrir a próxima conversa.</h3>
                    <p>
                      Projetos em destaque aparecerão aqui quando forem publicados pela comunidade.
                    </p>
                  </div>
                  <Link to="/perfil">Completar portfólio</Link>
                </section>
              </section>
            </div>

            <section className="home-composer-panel">
              <header className="home-panel-heading">
                <div>
                  <p className="home-section-kicker">Sua vez</p>
                  <h2>Compartilhe o que está em movimento.</h2>
                </div>
              </header>
              <section className="composer" aria-label="Criar publicação">
                <ProfileAvatar
                  className="avatar avatar-coral"
                  fullName={displayName}
                  avatarUrl={profile?.avatar_url ?? null}
                />
                <div className="composer-body">
                  <div
                    className="composer-kind-selector"
                    role="radiogroup"
                    aria-label="Tipo de publicação"
                  >
                    <button
                      type="button"
                      className={postKind === "post" ? "active" : ""}
                      role="radio"
                      aria-checked={postKind === "post"}
                      disabled={publishing}
                      onClick={() => setPostKind("post")}
                    >
                      Publicação
                    </button>
                    <button
                      type="button"
                      className={postKind === "work" ? "active" : ""}
                      role="radio"
                      aria-checked={postKind === "work"}
                      disabled={publishing}
                      onClick={() => setPostKind("work")}
                    >
                      Trabalho
                    </button>
                  </div>
                  <textarea
                    ref={composerInputRef}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Compartilhe uma ideia, oportunidade ou projeto"
                    maxLength={300}
                    disabled={publishing}
                  />
                  <MediaPicker
                    key={mediaKey}
                    value={media}
                    onChange={setMedia}
                    disabled={publishing}
                    onBusyChange={setMediaBusy}
                  />
                  <div className="composer-actions">
                    <button
                      type="button"
                      className="publish-button"
                      disabled={!message.trim() || publishing || mediaBusy}
                      onClick={() => void publish()}
                    >
                      {publishing ? "Publicando…" : "Publicar"} <Send size={15} />
                    </button>
                  </div>
                  {composerError ? (
                    <p className="home-inline-error" role="alert">
                      {composerError}
                    </p>
                  ) : null}
                </div>
              </section>
            </section>

            <section className="home-next-steps">
              <div className="home-context-heading">
                <span className="home-context-icon" aria-hidden="true">
                  <Sparkles size={17} />
                </span>
                <div>
                  <p className="home-section-kicker">Próximo passo</p>
                  <h2>Construa sua presença.</h2>
                </div>
              </div>
              <p>Pequenas ações deixam seu perfil pronto para as oportunidades certas.</p>
              <div className="home-next-step-actions">
                <Link to="/perfil">
                  <Pencil size={16} aria-hidden="true" /> Completar portfólio
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
                <Link to="/oportunidades">
                  <BriefcaseBusiness size={16} aria-hidden="true" /> Explorar oportunidades
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
            </section>

            <section className="home-trending-card" aria-labelledby="home-trending-title">
              <header>
                <div>
                  <p className="home-section-kicker">Em alta na Looma</p>
                  <h2 id="home-trending-title">Áreas para explorar</h2>
                </div>
                <Compass size={18} aria-hidden="true" />
              </header>
              {interestsLoading ? (
                <div className="home-trending-skeleton" aria-label="Carregando áreas">
                  <i />
                  <i />
                  <i />
                </div>
              ) : interestsError ? (
                <p className="home-trending-state" role="alert">
                  Não foi possível carregar as áreas agora.
                </p>
              ) : interests.length ? (
                <div className="home-trending-list">
                  {interests.slice(0, 6).map((interest) => (
                    <Link key={interest.id} to="/oportunidades">
                      {interest.name}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="home-trending-state">
                  As áreas profissionais aparecerão aqui assim que estiverem disponíveis.
                </p>
              )}
            </section>

            <section className="home-feed-companion">
              <p className="home-section-kicker">Sua rede</p>
              <h2>Boas conversas viram oportunidades.</h2>
              <p>Conheça profissionais, acompanhe ideias e dê o próximo passo no seu ritmo.</p>
              <Link to="/conexoes" className="home-companion-link">
                <UsersRound size={16} aria-hidden="true" /> Conhecer pessoas
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </section>
          </aside>
        </div>
        {searchPosition ? (
          <div
            ref={searchOverlayRef}
            className={`feed-search-overlay ${searchPhase === "compact" ? "is-compact" : ""} ${searchPhase === "opening-space" ? "is-leaving" : ""} ${searchPhase === "revealing" ? "is-revealing" : ""} ${searchPhase === "returning" ? "is-returning" : ""} ${searchInversion ? "is-inverted" : ""}`}
            style={{
              left: searchPosition.left,
              top: searchPosition.top,
              width: searchPosition.width,
              transform: searchInversion
                ? `translate(${searchInversion.left}px, ${searchInversion.top}px) scaleX(${searchInversion.width})`
                : undefined,
            }}
          >
            <label className="aside-search">
              <Search size={17} aria-hidden="true" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onClick={openSearch}
                onFocus={openSearch}
                onBlur={() => {
                  window.setTimeout(() => {
                    if (!searchOverlayRef.current?.contains(document.activeElement)) closeSearch();
                  }, 0);
                }}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeSearch();
                }}
                placeholder="Buscar na Looma"
                aria-label="Buscar na Looma"
              />
            </label>
            {hasSearchQuery ? (
              <section className="home-search-results" aria-label="Resultados da busca">
                {searchQuery.trim().length < 2 ? (
                  <p>Digite pelo menos 2 caracteres para buscar.</p>
                ) : searchResults.length ? (
                  <ul>
                    {searchResults.map((result) =>
                      result.type === "profile" ? (
                        <li key={`profile-${result.id}`}>
                          <Link
                            to="/perfil/$username"
                            params={{ username: result.username }}
                            onClick={closeSearch}
                          >
                            <UserRound size={16} aria-hidden="true" />
                            <span>
                              <strong>{result.title}</strong>
                              <small>{result.detail}</small>
                            </span>
                          </Link>
                        </li>
                      ) : result.type === "opportunity" ? (
                        <li key={`opportunity-${result.id}`}>
                          <Link to="/oportunidades" onClick={closeSearch}>
                            <BriefcaseBusiness size={16} aria-hidden="true" />
                            <span>
                              <strong>{result.title}</strong>
                              <small>{result.detail}</small>
                            </span>
                          </Link>
                        </li>
                      ) : (
                        <li key={`post-${result.id}`}>
                          <button type="button" onClick={() => focusPostFromSearch(result.id)}>
                            <FileText size={16} aria-hidden="true" />
                            <span>
                              <strong>{result.title}</strong>
                              <small>{result.detail}</small>
                            </span>
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <p>Nenhum resultado foi encontrado no conteúdo carregado.</p>
                )}
              </section>
            ) : null}
          </div>
        ) : null}
        <nav className="mobile-feed-nav" aria-label="Looma">
          <span className="looma-logo-mark mobile-logo" role="img" aria-label="Looma" />
        </nav>
      </section>
      <Dialog open={postPendingDeletion !== null} onOpenChange={handlePostDeletionDialogChange}>
        <DialogContent
          showClose={false}
          className="post-delete-dialog"
          onEscapeKeyDown={(event) => {
            if (deletingPostId) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (deletingPostId) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="post-delete-title">Excluir esta publicação?</DialogTitle>
            <DialogDescription className="post-delete-description">
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          {postActionError ? (
            <p className="post-delete-error" role="alert">
              {postActionError}
            </p>
          ) : null}
          <DialogFooter className="post-delete-actions">
            <DialogClose asChild>
              <button
                type="button"
                className="post-delete-cancel"
                disabled={deletingPostId !== null}
              >
                Cancelar
              </button>
            </DialogClose>
            <button
              type="button"
              className="post-delete-confirm"
              onClick={() => {
                if (postPendingDeletion) void deletePost(postPendingDeletion);
              }}
              disabled={deletingPostId !== null}
            >
              {deletingPostId ? "Excluindo…" : "Excluir"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={proposalPost !== null} onOpenChange={handleProposalDialogChange}>
        <DialogContent showClose={!sendingProposal} className="post-proposal-dialog">
          <DialogHeader>
            <DialogTitle>Enviar proposta</DialogTitle>
            <DialogDescription>
              Escreva uma mensagem de até {MAX_PROPOSAL_MESSAGE_LENGTH.toLocaleString("pt-BR")}{" "}
              caracteres para esta oportunidade de trabalho.
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
    </main>
  );
}
