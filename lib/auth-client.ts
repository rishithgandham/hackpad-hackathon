import { createAuthClient } from "better-auth/react"
export const authClient = createAuthClient({
    trustedOrigins: ["http://localhost:3000", "https://hackpad-hackathon.vercel.app/"],
})

export const { signIn, signUp, useSession, signOut } = createAuthClient()