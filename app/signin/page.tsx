import SignIn from "@/components/sign-in-page";
import { getSession } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function SignInPage() {
  const session = await getSession({
    headers: await headers(),
  });

  // If user is already authenticated, redirect to dashboard
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex bg-background items-center justify-center p-4">
      <div className="w-full max-w-md">
        <SignIn />
      </div>
    </div>
  );
}