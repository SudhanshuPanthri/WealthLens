import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <Compass className="h-10 w-10 text-accent" />
      <h1 className="mt-6 text-2xl font-bold">Page not found</h1>
      <p className="mt-2 max-w-md text-muted">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link href="/" className="mt-8 rounded-xl bg-accent px-6 py-3 font-semibold text-bg hover:opacity-90">
        Back home
      </Link>
    </div>
  );
}
