"use client";

import type { Lang } from "@/lib/format";
import { Icon } from "@/components/ui/icons";
import { toggleWish, useWishlist } from "@/components/shop/wishlist";

export function WishButton({ slug, lang, className = "" }: { slug: string; lang: Lang; className?: string }) {
  const on = useWishlist().includes(slug);
  const label = lang === "fa" ? (on ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها") : on ? "Remove from wishlist" : "Add to wishlist";
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleWish(slug);
      }}
      className={`grid size-11 place-items-center transition-colors ${on ? "text-gold" : "text-ink-2 hover:text-ink"} ${className}`}
    >
      <Icon name="heart" className="size-5" fill={on ? "currentColor" : "none"} />
    </button>
  );
}
