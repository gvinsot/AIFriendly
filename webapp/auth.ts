import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraId from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  trustHost: true,
  debug: process.env.NODE_ENV === "development",
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    MicrosoftEntraId({
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      // Microsoft consumers tenant ID (personal accounts)
      issuer: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
      authorization: {
        params: {
          scope: "openid profile email User.Read",
        },
      },
    }),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
      }
      // Refresh subscription status on sign-in, explicit update, or every 5 min
      const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
      const lastChecked = (token.subscriptionCheckedAt as number) || 0;
      const isStale = Date.now() - lastChecked > REFRESH_INTERVAL_MS;
      if (user || trigger === "update" || isStale) {
        const dbUser = await prisma.user.findUnique({
          where: { id: (token.id as string) },
          select: { stripeCurrentPeriodEnd: true },
        });
        token.isSubscribed =
          !!dbUser?.stripeCurrentPeriodEnd &&
          dbUser.stripeCurrentPeriodEnd.getTime() > Date.now();
        token.subscriptionCheckedAt = Date.now();
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        (session.user as any).isSubscribed = token.isSubscribed as boolean;
      }
      return session;
    },
    redirect({ url, baseUrl }) {
      // Allow relative URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Allow same-origin URLs
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },
});
