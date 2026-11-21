import type { Metadata } from "next";
import { Suspense } from "react";
import { login } from "@/app/auth/actions";
import { AuthForm } from "@/app/auth/auth-form";
import { ConfirmationError } from "./confirmation-error";

export const metadata: Metadata = {
  title: "Sign in · TaskFlow",
};

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      {/* Reads the URL, so it renders on the client; the form stays static. */}
      <Suspense fallback={null}>
        <ConfirmationError />
      </Suspense>
      <AuthForm action={login} mode="login" />
    </main>
  );
}
