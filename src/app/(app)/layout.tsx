import { redirect } from "next/navigation";
import Nav from "@/components/Nav";
import { getSessionUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen">
      <Nav userName={user.name} userEmail={user.email} userAvatar={user.avatarUrl} />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-6 pb-8 pt-4 text-xs text-muted">
        Market data may be delayed. AI insights are generated analysis, not investment advice —
        consult a SEBI-registered advisor before acting.
      </footer>
    </div>
  );
}
