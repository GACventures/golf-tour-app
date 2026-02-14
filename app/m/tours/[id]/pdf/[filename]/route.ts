import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ...rest of your existing route handler code...


const PDF_TOUR_ID = "5a80b049-396f-46ec-965e-810e738471b6";
const BUCKET = "tours-pdfs-v2";

const allowed = new Set([
  "itinerary.pdf",
  "accommodation.pdf",
  "dining.pdf",
  "profiles.pdf",
  "comps.pdf",
]);

function norm(s: string) {
  return (s ?? "").trim().toLowerCase();
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string; filename: string }> }
) {
  const { id, filename: rawFilename } = await context.params;

  const tourId = norm(id);
  const filename = decodeURIComponent(rawFilename);

  // 1) Tour gate
  if (tourId !== norm(PDF_TOUR_ID)) {
    return new NextResponse("Not found (tour does not have PDFs)", { status: 404 });
  }

  // 2) Filename gate
  if (!allowed.has(filename)) {
    return new NextResponse("Not found (filename not allowed)", { status: 404 });
  }

  // 3) Env check
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return new NextResponse("Server misconfigured (missing NEXT_PUBLIC_SUPABASE_URL)", {
      status: 500,
    });
  }

  // 4) Fetch public PDF and stream it from your domain
  const base = supabaseUrl.replace(/\/$/, "");
  const path = `tours/tours/${tourId}/${filename}`;
  const publicUrl = `${base}/storage/v1/object/public/${BUCKET}/${path}`;

  const upstream = await fetch(publicUrl, { cache: "no-store" });

  if (!upstream.ok) {
    return new NextResponse(
      `Not found (upstream ${upstream.status} fetching ${publicUrl})`,
      { status: 404 }
    );
  }

  const body = upstream.body;
  if (!body) {
    return new NextResponse("Not found (empty upstream body)", { status: 404 });
  }

  const contentType = upstream.headers.get("content-type") || "application/pdf";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
