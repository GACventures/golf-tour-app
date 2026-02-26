export function parseAdminUserIds(raw: string | undefined | null): Set<string> {
  const s = String(raw ?? "").trim();
  if (!s) return new Set();
  const ids = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return new Set(ids);
}

export function isAdminUserId(userId: string | undefined | null): boolean {
  const uid = String(userId ?? "").trim();
  if (!uid) return false;

  const allow = parseAdminUserIds(process.env.NEXT_PUBLIC_ADMIN_USER_IDS);
  return allow.has(uid);
}