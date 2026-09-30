import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft, EyeOff } from "lucide-react";
import { z } from "zod";
import { getUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { formatScore } from "@/lib/entries/score";
import { avatarUrl } from "@/lib/profiles/avatar-url";
import { loadReviewPage, loadThreads } from "@/lib/reviews/discussion";
import type { ThreadPage } from "@/lib/reviews/discussion-types";
import { Avatar } from "@/components/avatar";
import { MoviePoster } from "@/components/movies/poster";
import { SpoilerText } from "@/components/reviews/spoiler-text";
import { LikeButton } from "@/components/reviews/like-button";
import { Discussion } from "@/components/reviews/discussion";
import {
  DeleteReview,
  ReviewPageSafety,
} from "@/components/reviews/review-page-controls";

type Props = { params: Promise<{ id: string }> };

const review = cache(async (value: string) => {
  const id = z.uuid().safeParse(value);
  return id.success ? loadReviewPage(id.data) : null;
});

/** Username, movie and score only: never review text, so spoilers can't leak. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await review((await params).id);
  if (!data) return { title: "Review" };
  return {
    title: `@${data.author.username} on ${data.movie.title}`,
    description:
      data.score !== null
        ? `@${data.author.username} rated ${data.movie.title} ${formatScore(data.score)}/10 on CodeBox Movies.`
        : `@${data.author.username} reviewed ${data.movie.title} on CodeBox Movies.`,
    ...(data.hidden ? { robots: { index: false, follow: false } } : {}),
  };
}

function when(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function ReviewPage({ params }: Props) {
  const { id } = await params;
  const [data, user] = await Promise.all([review(id), getUser()]);
  if (!data) notFound();
  let page: ThreadPage | null = null;
  try {
    page = await loadThreads(data.id, null);
  } catch {
    page = null;
  }
  let viewer: { id: string; username: string; avatar: string | null } | null =
    null;
  if (user?.email_confirmed_at) {
    const supabase = await createClient();
    const { data: me } = await supabase
      .from("users")
      .select("username, avatar")
      .eq("id", user.id)
      .maybeSingle();
    if (me?.username)
      viewer = { id: user.id, username: me.username, avatar: me.avatar };
  }
  const own = viewer?.id === data.author.id;
  const signInHref = `/auth/sign-in?next=${encodeURIComponent(`/reviews/${data.id}`)}`;

  return (
    <article className="mx-auto max-w-2xl py-10 sm:py-14">
      <Link
        href={`/movies/${data.movie.id}`}
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {data.movie.title}
      </Link>

      {data.hidden && (
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-line p-3 text-sm text-muted">
          <EyeOff size={16} className="mt-0.5 shrink-0" aria-hidden="true" />A
          moderator hid this review, so only you can see it.
        </p>
      )}

      <header className="mt-8 flex gap-5">
        <Link
          href={`/movies/${data.movie.id}`}
          className="w-20 shrink-0 sm:w-24"
        >
          <MoviePoster
            path={data.movie.poster}
            title={data.movie.title}
            size="w342"
          />
        </Link>
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-tight">
            {data.movie.title}
            {data.movie.year && (
              <span className="text-muted"> ({data.movie.year})</span>
            )}
          </h1>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Avatar src={avatarUrl(data.author.avatar)} size={28} />
            <Link
              href={`/u/${data.author.username}`}
              className="font-semibold hover:text-accent"
            >
              @{data.author.username}
            </Link>
          </div>
          <p className="mt-1 text-xs text-muted">
            {when(data.createdAt)}
            {data.edited && " · edited"}
          </p>
        </div>
      </header>

      {data.score !== null && (
        <p className="mt-6 font-display text-4xl">
          <span className="tabular-nums">{formatScore(data.score)}</span>
          <span className="text-lg text-muted">/10</span>
        </p>
      )}
      {data.note && (
        <SpoilerText
          text={data.note}
          spoiler={data.spoiler}
          kind="review"
          className="mt-4 whitespace-pre-line leading-relaxed"
        />
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <LikeButton
          reviewId={data.id}
          initialLiked={data.liked}
          initialCount={data.likeCount}
          mode={!viewer ? "guest" : own ? "own" : "can-like"}
          signInHref={signInHref}
        />
        {own && (
          <>
            <Link
              href={`/movies/${data.movie.id}?edit=${data.id}`}
              className="text-sm text-muted hover:text-ink"
            >
              Edit review
            </Link>
            <DeleteReview
              reviewId={data.id}
              movieId={data.movie.id}
              likeCount={data.likeCount}
              commentCount={data.commentCount}
            />
          </>
        )}
      </div>
      {viewer && !own && (
        <ReviewPageSafety
          reviewId={data.id}
          authorId={data.author.id}
          username={data.author.username}
          movieId={data.movie.id}
        />
      )}

      {page ? (
        <Discussion
          reviewId={data.id}
          initial={page}
          viewer={
            viewer ? { username: viewer.username, avatar: viewer.avatar } : null
          }
          signInHref={signInHref}
        />
      ) : (
        <p role="alert" className="mt-12 text-sm text-muted">
          The discussion is unavailable right now. Please refresh to try again.
        </p>
      )}
    </article>
  );
}
