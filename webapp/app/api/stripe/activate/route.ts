import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/stripe/activate
 * Called after returning from Stripe Checkout to activate the subscription
 * directly, without depending on the webhook delivery.
 */
export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const sessionId = body.sessionId;
  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  // Retrieve the checkout session from Stripe
  const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);

  // Verify this checkout belongs to the current user
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeCustomerId: true },
  });

  if (!user?.stripeCustomerId || user.stripeCustomerId !== checkoutSession.customer) {
    return NextResponse.json({ error: "Session mismatch" }, { status: 403 });
  }

  if (checkoutSession.payment_status !== "paid") {
    return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
  }

  if (!checkoutSession.subscription) {
    return NextResponse.json({ error: "No subscription found" }, { status: 400 });
  }

  // Retrieve full subscription details
  const subscription = await stripe.subscriptions.retrieve(
    checkoutSession.subscription as string
  );

  // Update the user record
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      stripeSubscriptionId: subscription.id,
      stripePriceId: subscription.items.data[0]?.price.id ?? null,
      stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
    },
  });

  return NextResponse.json({ activated: true });
}
