"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Round = {
  id: string;
  name: string;
  course_id: string | null;
  // ✅ Supabase relationship often returns an array
  courses?: { name: string }[] | null;
};

type PlayingPlayer = {
  id: string;
  name: string;
  playing_handicap: number;
};

export default function MobilePlayerSelectPage() {
  const params = useParams();
  const router = useRouter();
  const roundId = (params?.id as string) || "";

  const [round, setRound] = useState<Round | null>(null);
  const [playingPlayers, setPlayingPlayers] = useState<PlayingPlayer[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [buddyId, setBuddyId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!roundId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  async function load() {
    setLoading(true);
    setErrorMsg("");

    // 1) Round header info
    const { data: roundData, error: roundError } = await supabase
      .from("rounds")
      .select(
        `
        id,
        name,
        course_id,
        courses ( name )
      `
      )
      .eq("id", roundId)
      .single();

    if (roundError) {
      setErrorMsg(roundError.message);
      setLoading(false);
      return;
    }

    // ✅ Cast via unknown to avoid TS "insufficient overlap" error
    setRound(roundData as unknown as Round);

    // 2) ONLY players who are playing in this round
    const { data: rp, error: rpError } = await supabase
      .from("round_players")
      .select(
        `
        playing,
        playing_handicap,
        players ( id, name )
      `
      )
      .eq("round_id", roundId)
      .eq("playing", true)
      .order("created_at", { ascending: true });

    if (rpError) {
      setErrorMsg(rpError.message);
      setLoading(false);
      return;
    }

    const list: PlayingPlayer[] = (Array.isArray(rp) ? rp : []).map((row: any) => ({
      id: row.players?.id,
      name: row.players?.name,
      playing_handicap: row.playing_handicap ?? 0,
    }));

    // Filter out any malformed rows just in case
    const clean = list.filter((p) => !!p.id && !!p.name);

    setPlayingPlayers(clean);

    // If we already had selections and they no longer exist, clear them
    setMeId((prev) => (prev && clean.some((p) => p.id === prev) ? prev : null));
    setBuddyId((prev) => (prev && clean.some((p) => p.id === prev) ? prev : null));

    setLoading(false);
  }

  // Buddy choices = playing players excluding Me
  const buddyOptions = useMemo(() => {
    if (!meId) return [];
    return playingPlayers.filter((p) => p.id !== meId);
  }, [playingPlayers, meId]);

  function continueToScoreEntry() {
    if (!meId) return;

    const qs = new URLSearchParams();
    qs.set("me", meId);
    if (buddyId) qs.set("buddy", buddyId);

    router.push(`/rounds/${roundId}/mobile/score?${qs.toString()}`);
  }

  const courseName = round?.courses?.[0]?.name ?? "";

  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Mobile entry mode</h2>
        <p>Loading…</p>
        {errorMsg && <p style={{ color: "red" }}>Error: {errorMsg}</p>}
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Mobile entry mode</h2>
          <div style={{ fontSize: 14, opacity: 0.85 }}>
            <div>
              <strong>Round:</strong> {round?.name ?? "—"}
            </div>
            {courseName && (
              <div>
                <strong>Course:</strong> {courseName}
              </div>
            )}
          </div>
        </div>

        <Link
          href={`/rounds/${roundId}`}
          style={{ fontSize: 14, textDecoration: "underline", whiteSpace: "nowrap", marginTop: 4 }}
        >
          Back to round
        </Link>
      </div>

      {errorMsg && (
        <p style={{ color: "red", marginTop: 12 }}>
          Error: {errorMsg}
        </p>
      )}

      {playingPlayers.length === 0 ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>No playing players</h3>
          <p style={{ marginBottom: 0 }}>
            This mobile mode only allows selecting players who are marked as <strong>playing</strong>. Go back to the
            round page and assign players / tick “playing”, then return here.
          </p>
        </div>
      ) : (
        <>
          {/* ME */}
          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Who are you?</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {playingPlayers.map((p) => {
                const selected = meId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setMeId(p.id);
                      // If buddy was same as new me, clear buddy
                      setBuddyId((b) => (b === p.id ? null : b));
                    }}
                    style={{
                      textAlign: "left",
                      padding: "12px 12px",
                      borderRadius: 10,
                      border: selected ? "2px solid #2563eb" : "1px solid #d1d5db",
                      background: selected ? "#eff6ff" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
                    <div style={{ fontSize: 13, opacity: 0.8 }}>Playing handicap: {p.playing_handicap}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* BUDDY */}
          <div style={{ marginTop: 18 }}>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Add a buddy (optional)</h3>

            {!meId ? (
              <p style={{ marginTop: 0, opacity: 0.8 }}>Select “Me” first.</p>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {buddyOptions.map((p) => {
                    const selected = buddyId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setBuddyId(p.id)}
                        style={{
                          textAlign: "left",
                          padding: "12px 12px",
                          borderRadius: 10,
                          border: selected ? "2px solid #16a34a" : "1px solid #d1d5db",
                          background: selected ? "#f0fdf4" : "#fff",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
                        <div style={{ fontSize: 13, opacity: 0.8 }}>Playing handicap: {p.playing_handicap}</div>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setBuddyId(null)}
                  disabled={!buddyId}
                  style={{
                    marginTop: 10,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #d1d5db",
                    background: buddyId ? "#fff" : "#f3f4f6",
                    color: buddyId ? "#111827" : "#6b7280",
                    cursor: buddyId ? "pointer" : "not-allowed",
                    width: "100%",
                  }}
                >
                  No buddy (just me)
                </button>
              </>
            )}
          </div>

          {/* CONTINUE */}
          <div style={{ marginTop: 18 }}>
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                setBusy(true);
                try {
                  continueToScoreEntry();
                } finally {
                  setTimeout(() => setBusy(false), 400);
                }
              }}
              disabled={!meId || busy}
              style={{
                width: "100%",
                padding: "12px 12px",
                borderRadius: 12,
                border: "1px solid #111827",
                background: !meId ? "#e5e7eb" : "#111827",
                color: !meId ? "#6b7280" : "#fff",
                fontWeight: 700,
                cursor: !meId ? "not-allowed" : "pointer",
              }}
            >
              Continue to score entry
            </button>

            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              Only players marked as <strong>playing</strong> can be selected.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
