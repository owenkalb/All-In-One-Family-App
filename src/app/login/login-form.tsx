"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

const input =
  "w-full rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const signInState = useActionState<AuthState, FormData>(signIn, {});
  const signUpState = useActionState<AuthState, FormData>(signUp, {});
  const [state, action, pending] = mode === "signin" ? signInState : signUpState;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      {mode === "signup" && (
        <label className="flex flex-col gap-1 text-sm">
          Your name
          <input name="name" required maxLength={80} className={input} />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input name="email" type="email" required autoComplete="email" className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          className={input}
        />
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p className="text-sm text-green-700">{state.message}</p>}

      <button
        disabled={pending}
        className="rounded-md bg-foreground px-3 py-2 font-medium text-background disabled:opacity-50"
      >
        {mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="text-sm underline"
      >
        {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </form>
  );
}
