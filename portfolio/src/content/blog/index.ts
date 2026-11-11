import type { ImageMedia, Media, Post } from "@/content/types";
import { ispc2026 } from "@/content/blog/ispc-2026";

/** Every post, newest first. Each exists in both languages under the same slug. */
export const POSTS: Post[] = [ispc2026];

export function getPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

/** Every picture of a post in reading order (cover first), as the lightbox pages through them. */
export function postImages(p: Post): ImageMedia[] {
  const out: Media[] = [p.cover];
  for (const b of p.blocks) {
    if (b.kind === "figure") out.push(b.media);
    if (b.kind === "gallery") out.push(...b.items);
  }
  return out.filter((m): m is ImageMedia => m.kind === "image");
}
