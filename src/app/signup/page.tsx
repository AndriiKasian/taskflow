import type { Metadata } from "next";
import { signup } from "@/app/auth/actions";
import { AuthForm } from "@/app/auth/auth-form";

export const metadata: Metadata = {
  title: "Sign up · TaskFlow",
};

export default function SignupPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <AuthForm action={signup} mode="signup" />
    </main>
  );
}
