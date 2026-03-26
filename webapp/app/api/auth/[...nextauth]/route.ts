import { handlers } from "@/auth";

// Wrap handlers to catch UnknownAction from bots/scanners hitting invalid paths like /api/auth/*
function withAuthErrorHandler(handler: Function) {
  return async (req: Request, ctx: any) => {
    try {
      return await handler(req, ctx);
    } catch (error: any) {
      if (error?.name === "UnknownAction") {
        return new Response(null, { status: 400 });
      }
      throw error;
    }
  };
}

export const GET = withAuthErrorHandler(handlers.GET);
export const POST = withAuthErrorHandler(handlers.POST);
