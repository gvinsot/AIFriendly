import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Webhook signature verification failed: ${message}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`[Stripe Webhook] checkout.session.completed — customer: ${session.customer}, subscription: ${session.subscription}, payment_status: ${session.payment_status}`);
        if (session.subscription && session.customer) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          );
          await prisma.user.update({
            where: { stripeCustomerId: session.customer as string },
            data: {
              stripeSubscriptionId: subscription.id,
              stripePriceId: subscription.items.data[0]?.price.id,
              stripeCurrentPeriodEnd: new Date(
                subscription.current_period_end * 1000
              ),
            },
          });
          console.log(`[Stripe Webhook] User updated for customer ${session.customer}`);
        }
        break;
      }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(
          invoice.subscription as string
        );
        await prisma.user.update({
          where: { stripeCustomerId: invoice.customer as string },
          data: {
            stripePriceId: subscription.items.data[0]?.price.id,
            stripeCurrentPeriodEnd: new Date(
              subscription.current_period_end * 1000
            ),
          },
        });
      }
      break;
    }

    case "invoice_payment.paid": {
      // Stripe API 2026+ sends invoice_payment.paid instead of invoice.payment_succeeded
      const invoicePayment = event.data.object as { invoice: string };
      const invoice = await stripe.invoices.retrieve(invoicePayment.invoice);
      if (invoice.subscription) {
        const subscription = await stripe.subscriptions.retrieve(
          invoice.subscription as string
        );
        await prisma.user.update({
          where: { stripeCustomerId: invoice.customer as string },
          data: {
            stripeSubscriptionId: subscription.id,
            stripePriceId: subscription.items.data[0]?.price.id,
            stripeCurrentPeriodEnd: new Date(
              subscription.current_period_end * 1000
            ),
          },
        });
        console.log(`[Stripe Webhook] invoice_payment.paid — updated user for customer ${invoice.customer}`);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await prisma.user.update({
        where: { stripeCustomerId: subscription.customer as string },
        data: {
          stripeSubscriptionId: null,
          stripePriceId: null,
          stripeCurrentPeriodEnd: null,
        },
      });
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      await prisma.user.update({
        where: { stripeCustomerId: subscription.customer as string },
        data: {
          stripePriceId: subscription.items.data[0]?.price.id,
          stripeCurrentPeriodEnd: new Date(
            subscription.current_period_end * 1000
          ),
        },
      });
      break;
    }

    default:
      console.warn(`[Stripe Webhook] Unhandled event type: ${event.type} (${event.id})`);
  }
  } catch (err) {
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
