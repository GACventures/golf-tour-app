export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    time: new Date().toISOString(),
  });
}
