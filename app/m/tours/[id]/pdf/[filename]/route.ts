// app/m/tours/[id]/pdf/[filename]/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function buildPublicUrl(tourId: string, filename: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;

  const base = supabaseUrl.replace(/\/$/, "");
  const path = `tours/tours/${tourId}/${filename}`;
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

function commonHeaders(filename: string, contentType: string) {
  return {
    "Content-Type": contentType || "application/pdf",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "no-store",
    // Encourage proper PDF.js behavior
    "Accept-Ranges": "bytes",
  } as Record<string, string>;
}

async function handle(req: Request, context: { params: Promise<{ id: string; filename: string }> }, method: "GET" | "HEAD") {
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

  const publicUrl = buildPublicUrl(tourId, filename);
  if (!publicUrl) {
    return new NextResponse("Server misconfigured (missing NEXT_PUBLIC_SUPABASE_URL)", { status: 500 });
  }

  // Forward Range header (PDF.js uses it for incremental loading)
  const range = req.headers.get("range") || undefined;

  const upstream = await fetch(publicUrl, {
    method,
    cache: "no-store",
    headers: range ? { range } : undefined,
  });

  if (!upstream.ok) {
    return new NextResponse(`Not found (upstream ${upstream.status})`, { status: 404 });
  }

  const contentType = upstream.headers.get("content-type") || "application/pdf";

  // HEAD: no body, only headers
  if (method === "HEAD") {
    const res = new NextResponse(null, {
      status: upstream.status,
      headers: {
        ...commonHeaders(filename, contentType),
      },
    });

    const len = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");

    if (len) res.headers.set("Content-Length", len);
    if (contentRange) res.headers.set("Content-Range", contentRange);

    return res;
  }

  const body = upstream.body;
  if (!body) {
    return new NextResponse("Not found (empty upstream body)", { status: 404 });
  }

  // If Range was used, upstream may return 206 + Content-Range
  const status = upstream.status; // 200 or 206 typically

  const res = new NextResponse(body, {
    status,
    headers: {
      ...commonHeaders(filename, contentType),
    },
  });

  const len = upstream.headers.get("content-length");
  const contentRange = upstream.headers.get("content-range");

  if (len) res.headers.set("Content-Length", len);
  if (contentRange) res.headers.set("Content-Range", contentRange);

  return res;
}

export async function GET(req: Request, context: { params: Promise<{ id: string; filename: string }> }) {
  return handle(req, context, "GET");
}

export async function HEAD(req: Request, context: { params: Promise<{ id: string; filename: string }> }) {
  return handle(req, context, "HEAD");
}