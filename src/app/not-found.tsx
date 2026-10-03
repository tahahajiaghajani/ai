import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { Logo } from "@/components/shell/logo";

export default function NotFound() {
  return (
    <div className="grid min-h-[70dvh] place-items-center px-6 text-center">
      <div className="flex flex-col items-center">
        <Logo className="size-12" />
        <p dir="ltr" className="font-brand mt-6 text-6xl font-semibold tracking-[-0.04em] text-gradient">
          404
        </p>
        <h1 className="mt-3 text-lg font-black">صفحه پیدا نشد</h1>
        <Link href="/" className="mt-6">
          <Button>خانه</Button>
        </Link>
      </div>
    </div>
  );
}
