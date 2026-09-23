import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server/http-client";

export const dynamic = "force-dynamic";
export const revalidate = 30; // 30-second stale-while-revalidate

interface SupabaseProjectionRow {
  id: string;
  as_of: string;
  currency: string;
  currency_symbol: string;
  courses: unknown[];
  projection_version: number;
  projected_at: string;
}

export async function GET() {
  try {
    const supabase = createSupabaseServerClient();
    const rows = await supabase.requestJson<SupabaseProjectionRow[]>(
      "/rest/v1/tikhon_public_projection?id=eq.current&select=*",
      { method: "GET" },
    );

    if (Array.isArray(rows) && rows.length > 0) {
      const projection = rows[0];
      return NextResponse.json(
        {
          as_of: projection.as_of,
          currency: projection.currency,
          currency_symbol: projection.currency_symbol,
          courses: projection.courses,
          projection_version: projection.projection_version,
          projected_at: projection.projected_at,
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          },
        },
      );
    }

    return NextResponse.json(
      { error: "Tikhon projection not found in upstream store" },
      { status: 502 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to connect to Tikhon projection store", details: message },
      { status: 503 },
    );
  }
}
