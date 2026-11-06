import { NextResponse } from "next/server";
import type { ServiceStatus } from "@/lib/types";
import { databaseProvider } from "@/server/db/client";
import { env, features } from "@/server/env";
import { route } from "@/server/http";
import { arkivInfo } from "@/server/services/blockchain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which optional services are configured. Never returns secrets. */
export const GET = route("health", async () => {
  const status: ServiceStatus = {
    claude: features.claude(),
    elevenlabs: features.elevenLabs(),
    arkiv: arkivInfo(),
    database: databaseProvider(),
    demoTools: env.demoTools,
  };
  return NextResponse.json(status);
});
