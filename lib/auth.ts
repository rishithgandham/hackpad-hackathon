import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db"; // your drizzle instance
import { verification, account, user, session } from "@/lib/schema";
import { nextCookies } from "better-auth/next-js";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg", // or "mysql", "sqlite"
        schema: {
            verification: verification,
            account: account,
            session: session,
            user: user,
        }
    }),
    socialProviders: {
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        },

    },
    plugins: [
        nextCookies(),
    ],
    emailAndPassword: {
        enabled: true,
    },
});

export const { getSession, signInEmail, signUpEmail, signOut, signInSocial } = auth.api;