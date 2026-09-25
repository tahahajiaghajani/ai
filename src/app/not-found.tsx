import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="grid min-h-[70dvh] place-items-center px-6 text-center">
      <div>
        <p className="text-gradient text-7xl font-black">۴۰۴</p>
        <h1 className="mt-4 text-xl font-black">صفحه پیدا نشد</h1>
        <p className="mt-2 text-sm text-muted">ممکن است این تسک حذف شده باشد یا به آن دسترسی نداشته باشید.</p>
        <Link href="/" className="mt-6 inline-block">
          <Button>بازگشت به خانه</Button>
        </Link>
      </div>
    </div>
  );
}
