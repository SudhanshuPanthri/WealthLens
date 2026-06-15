import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";
import { configuredProviders } from "@/lib/oauth";

export const metadata = { title: "Create account — WealthLens" };

export default function SignupPage() {
  return (
    <Suspense>
      <AuthForm mode="signup" providers={configuredProviders()} />
    </Suspense>
  );
}
