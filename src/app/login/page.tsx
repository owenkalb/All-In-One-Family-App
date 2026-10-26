import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Family App</h1>
      <Suspense>
        {searchParams.then(({ next, error }) => (
          <>
            {error === "confirm" && (
              <p className="text-sm text-red-600">
                That confirmation link is invalid or expired. Sign in, or sign
                up again to get a new link.
              </p>
            )}
            <LoginForm next={typeof next === "string" ? next : "/"} />
          </>
        ))}
      </Suspense>
    </main>
  );
}
