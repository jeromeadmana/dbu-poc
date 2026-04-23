import Link from "next/link";
import { signupAction } from "../actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; error?: string; callbackUrl?: string }>;
}) {
  const { ref, error, callbackUrl } = await searchParams;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow p-6 border border-zinc-200 dark:border-zinc-800">
      <h1 className="text-2xl font-semibold mb-1">Create account</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
        {ref ? (
          <>Signing up with referral code <code className="font-mono text-zinc-900 dark:text-zinc-100">{ref}</code></>
        ) : (
          "No referral code — you can add one later."
        )}
      </p>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <form action={signupAction} className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="name">Name</label>
          <input
            id="name" name="name" type="text" required autoComplete="name"
            className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="email">Email</label>
          <input
            id="email" name="email" type="email" required autoComplete="email"
            className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" htmlFor="password">Password</label>
          <input
            id="password" name="password" type="password" required minLength={8} autoComplete="new-password"
            className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
          />
          <p className="text-xs text-zinc-500 mt-1">Minimum 8 characters</p>
        </div>
        {ref && <input type="hidden" name="ref" value={ref} />}
        {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
        <button
          type="submit"
          className="w-full py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium hover:opacity-90 transition"
        >
          Create account
        </button>
      </form>

      <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-4 text-center">
        Already have an account?{" "}
        <Link
          href={`/signin${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}
          className="underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
