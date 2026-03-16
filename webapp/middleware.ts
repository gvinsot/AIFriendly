import { auth } from "@/auth";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isDashboard = req.nextUrl.pathname.startsWith("/dashboard");

  if (isDashboard && !isLoggedIn) {
    const signInUrl = new URL("/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return Response.redirect(signInUrl);
  }

  // Enforce active subscription for all dashboard routes except /dashboard/subscribe
  if (isDashboard && isLoggedIn) {
    const isSubscribePage = req.nextUrl.pathname === "/dashboard/subscribe";
    const isSubscribed = !!(req.auth as any)?.user?.isSubscribed;

    if (!isSubscribed && !isSubscribePage) {
      return Response.redirect(
        new URL("/dashboard/subscribe", req.nextUrl.origin)
      );
    }
  }
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
