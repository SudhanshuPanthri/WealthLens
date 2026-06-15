import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";
import { configuredProviders } from "@/lib/oauth";

export const metadata = { title: "Sign in — WealthLens" };

export default function LoginPage() {
  return (
    <Suspense>
      <AuthForm mode="login" providers={configuredProviders()} />
    </Suspense>
  );
}
