// app/m/user-guide/page.tsx
"use client";

import Link from "next/link";

const guide = `
# How to Use the Golf Tour app

This app is designed to manage a multi-round golf tour, record hole-by-hole scores, calculate **Stableford** points, and automatically adjust playing handicaps between rounds (if rehandicapping is enabled for the tour).

The app is optimised for mobile use during play.

---

## App Structure Overview

Each tour opens on the Tour Home / Landing Page, which provides access to all tour features:

- Daily tee times
- Daily scoring
- Daily results
- Leaderboards
- Competitions
- Stats
- Tour information and admin tools

---

## 1. Rounds (Daily Tee Times, Scoring, Results)

Each round belongs to a tour and is shown as a card.

### What you see

- Round number (e.g. Round 1, Round 2)
- Date (if set)
- Course name

### What you can tap

Depending on where you enter from the tour landing page (for example, tapping a round from **Tee Times** vs **Scoring**), tapping a round opens:

- Tee Times – view playing groups
- Scoring – enter scores
- Results – view round results

---

## 2. Scoring

### Purpose

Entry point for entering scores during a round.

### How it works

1. Select a round.
2. Choose Me (required).
3. Optionally choose a Buddy (for score cross-checking only).
4. Continue to the score entry screen.

### Important rules

- Only Me scores are official and saved to the tour.
- Buddy scores are optional and stored separately as a **personal cross-check only**.
- Buddy scores never overwrite the buddy’s own official scorecard.

---

## 2.1 Score Entry (Hole-by-Hole)

Each tour uses one of two score entry layouts. Both layouts do the same job and follow the same save rules.

### A) Classic approach (plus / minus)

- One hole is shown at a time.
- Use − / + buttons to decrease or increase strokes.
- Tap PAR to instantly set strokes equal to par.
- Tap P to mark a pickup.
- Stableford points for the hole are shown live.

### B) Alt approach (keypad)

- One hole is shown at a time.
- Use the numeric keypad to enter strokes directly.
- Tap 1- followed by a digit to enter scores from 10–19 (e.g. 1-2 = 12).
- Tap P to mark a pickup.
- Shots given, strokes, and Stableford points update live.

### Swiping and saving (critical)

- Swipe left / right to move between holes.
- When you swipe, Me scores are automatically saved (if they have changed).
- Buddy cross-check scores for the hole being left are also saved (separately).
- You can also tap Save (Me) at any time to force a save.

---

## 2.2 Summary Tab

- Shows a full 18-hole table for the selected player.
- Displays:
  - Hole number
  - Par
  - Stroke Index (SI)
  - Strokes (colour-coded)
  - Stableford points
- Front 9, Back 9, and Total subtotals are shown.
- Tapping a hole number returns you to Entry for that hole.

---

## 2.3 Getting to the summary tab via the TOTAL button

- Tapping TOTAL takes you directly to the Summary tab for that player.
- From the Summary tab you can:
  - Review hole-by-hole scoring
  - Jump back to any hole
  - Return to Entry to continue scoring

---

## 3. Results

### Purpose

Review results for a completed or in-progress round.

### What you see

- List of players
- Total Stableford points

### Interactions

- Tap a player to view:
  - Hole-by-hole scores
  - Stableford points per hole

Results always reflect **official saved scores only**, and the playing handicaps in effect for that round.

---

## 4. Leaderboards

### Purpose

Show standings across the tour or within competitions.

### Common behaviour

- Round scores shown in leaderboards are clickable
- Tapping a round score opens a detailed hole-by-hole breakdown

---

## 4.1 Individual Leaderboards

- Player rankings
- Total points or scores

Tap a round score to see how it was built up.

---

## 4.2 Pairs Leaderboards

- Pair rankings
- Aggregated or best-ball style scoring

Tap a round score to see round detail.

---

## 4.3 Teams Leaderboards

- Team rankings
- Team totals by round

Tap a team’s round score to see the calculation detail.

---

## 5. Competitions

### Purpose

Displays special tour competitions that run alongside standard Stableford scoring.

### How it works

The Competitions screen shows each player’s current result and rank for each competition. Some competitions can be tapped to see more detail.

### 5.1 Competitions and definitions

- Napoleon — Average Stableford points on Par 3 holes.
- Big George — Average Stableford points on Par 4 holes.
- Grand Canyon — Average Stableford points on Par 5 holes.
- Wizard — Percentage of holes where Stableford points are 4+.
- Bagel Man — Percentage of holes where Stableford points are 0 (lower is better).
- Eclectic — Total of each player’s best Stableford points per hole across the tour (best score recorded for each hole number is used, regardless of round).
  - Tap the Eclectic value to open the Eclectic breakdown.
- Schumacher — Average Stableford points on holes 1–3.
- Closer — Average Stableford points on holes 16–18.
- Hot Streak — Longest run (within any single round) of consecutive holes where gross strokes are par or better.
  - Tap the Hot Streak cell to see the round + hole range for the streak.
- Cold Streak — Longest run (within any single round) of consecutive holes where gross strokes is bogey or worse (lower is better).
  - Tap the Cold Streak cell to see the round + hole range for the streak.
- H2Z — Cumulative Stableford score on Par 3 holes that resets to zero whenever 0 points is scored on a hole.
  - Tap the H2Z cell to see the peak score and the number of holes in the peak run.
- Best of the Best (BotB) (if enabled) — Aggregates Stableford totals across selected rounds.
  - Tap the BotB column/cell (where shown) to open the BotB table.

### More information (clickable items)

- Eclectic: tap a player’s Eclectic value to open the Eclectic breakdown.
- Hot Streak / Cold Streak: tap the value to view the streak detail (round + hole range).
- H2Z: tap the value to view peak detail.
- BotB (if shown): tap the BotB value to open the BotB table.

---

## 6. Matchplay

### Purpose

Matchplay competitions run as head-to-head matches rather than being based purely on total Stableford points. Each match is decided hole-by-hole, and matchplay results roll up into the Matchplay leaderboard.

In addition to matchplay, a round may also be configured as **Individual Stableford**, which does not use matches but still contributes points to the Matchplay leaderboard.

### Supported formats

- Individual matchplay (1 vs 1)
- Better-ball matchplay (2 vs 2, best score per side per hole)
- Individual Stableford (no matches; players compete individually)

### Availability

If matchplay is not active for the tour or round, matchplay-specific buttons and screens are disabled. Individual Stableford rounds remain available and contribute to the leaderboard.

---

## 6.1 Matchplay & Round Format

Explains how scoring is structured for each round.

### Teams

- All matchplay formats are played between two tour teams (Team A vs Team B).
- Individual Stableford still uses the same tour teams, but players compete individually rather than in matches.

### Format options per round

- Individual matchplay
  - One player from Team A plays one player from Team B.
  - Each match is decided hole-by-hole.
- Better-ball matchplay
  - Two players from Team A play two players from Team B.
  - On each hole, the best Stableford score per side is used to decide the hole.
- Individual Stableford
  - No matches are created.
  - Each player scores Stableford points independently for the round.

### Double points (optional)

- If enabled, all points earned in that round are doubled, regardless of format.

---

## 6.2 Matchplay Results

Shows match-by-match results for matchplay rounds.

### Round results list

- Displays all matches for the selected round.
- Each match shows a live or final result summary as scores are entered.

### Match detail (tap a match)

The match detail screen shows:

- Match summary (result shown clearly on its own line)
- Round format (Individual or Better-ball matchplay)
- Sides (players or pairs)
- Hole-by-hole table showing:
  - Points per hole
  - Hole winner
  - Running match status (who is up after each hole)

### Live updates

- Match summaries update automatically as scores are entered or changed.

Note: This section is not shown for Individual Stableford rounds, as no matches exist.

---

## 6.3 Matchplay Leaderboard

Shows the overall standings across all rounds and formats.

### What it shows

- Team totals for Team A and Team B
- Individual player totals
- One column per round (R1, R2, …), plus a Total column

Each round column also displays a short format label (e.g. Ind. M/P, BB M/P, Ind. Stblfd) so it’s clear how points were earned.

---

## 6.4 How Points Are Awarded

### Individual Matchplay

- Each match awards:
  - Win: 1 point to the winning player
  - Tie: 0.5 points to each player
- Points count toward:
  - The individual player’s total
  - The team total (sum of player points)

### Better-Ball Matchplay

- Each match awards:
  - Win: 1 team point  
    - Awarded as 0.5 points to each winning player
  - Tie: 0.5 team points  
    - Awarded as 0.25 points to each player
- Player points sum to team points automatically.

### Individual Stableford

- Players earn net Stableford points on each hole using their playing handicap.
- At the end of the round:
  - Players are ranked by total Stableford points.
  - The top half of the field (including ties) earn leaderboard points:
    - Clear qualifiers receive 1 point
    - Tied players at the cutoff share points proportionally
- These points:
  - Count toward each player’s total
  - Are summed to produce team totals
- If double points is enabled, all awarded points for the round are doubled.

---

## 7. Stats

### Purpose

Provide performance insights across the tour.

Stats vary by tour setup and available data.

---

## 8. Tour Admin (Admin users only)

Tour Admin tools are accessed from the tour landing page.

### Available tools

- Set tour starting handicaps
- Edit course par and stroke index
- Build manual tee-time groups
- Choose score entry layout (Classic or Alt)
- Configure rehandicapping rules (if used)

### Tee Time Groups

- Tee-time groups are built manually per round
- Group order and player order matter
- Last saved changes always win
`;

type ListItem = { text: string; children?: ListItem[] };

function nestOneLevel(items: Array<{ level: 0 | 1; text: string }>): ListItem[] {
  const out: ListItem[] = [];
  let lastTop: ListItem | null = null;

  for (const it of items) {
    if (it.level === 0) {
      const node: ListItem = { text: it.text };
      out.push(node);
      lastTop = node;
      continue;
    }

    // level 1
    if (!lastTop) {
      // If a sub-item appears without a parent, treat it as a top-level item.
      out.push({ text: it.text });
      continue;
    }
    if (!lastTop.children) lastTop.children = [];
    lastTop.children.push({ text: it.text });
  }

  return out;
}

function renderInline(text: string) {
  // minimal **bold** support
  const parts = text.split("**");
  if (parts.length === 1) return text;

  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-semibold text-gray-900">
            {p}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function Markdown({ text }: { text: string }) {
  // Minimal markdown renderer (headings + lists (with 1-level nesting) + paragraphs + hr).
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const blocks: Array<
    | { type: "h1" | "h2" | "h3" | "p"; content: string }
    | { type: "hr" }
    | { type: "ul"; items: Array<{ level: 0 | 1; text: string }> }
  > = [];

  let currentList: Array<{ level: 0 | 1; text: string }> | null = null;

  const flushList = () => {
    if (currentList && currentList.length) blocks.push({ type: "ul", items: currentList });
    currentList = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushList();
      continue;
    }

    if (line.trim() === "---") {
      flushList();
      blocks.push({ type: "hr" });
      continue;
    }

    const h1 = line.match(/^# (.+)$/);
    const h2 = line.match(/^## (.+)$/);
    const h3 = line.match(/^### (.+)$/);
    if (h1) {
      flushList();
      blocks.push({ type: "h1", content: h1[1] });
      continue;
    }
    if (h2) {
      flushList();
      blocks.push({ type: "h2", content: h2[1] });
      continue;
    }
    if (h3) {
      flushList();
      blocks.push({ type: "h3", content: h3[1] });
      continue;
    }

    // Lists: support "-" and "•" plus one-level nesting via leading spaces.
    // In your guide text, nested bullets are written as "  - ..."
    const li = raw.match(/^(\s*)([-•])\s+(.+)$/);
    if (li) {
      const leading = li[1] ?? "";
      const bullet = li[2] ?? "-";
      const txt = (li[3] ?? "").trim();

      // Treat "•" as top-level even if spaced
      const level: 0 | 1 = bullet === "•" ? 0 : leading.length >= 2 ? 1 : 0;

      if (!currentList) currentList = [];
      currentList.push({ level, text: txt });
      continue;
    }

    flushList();
    blocks.push({ type: "p", content: line.trim() });
  }

  flushList();

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.type === "hr") return <div key={i} className="h-px bg-gray-200 my-2" />;

        if (b.type === "h1")
          return (
            <h1 key={i} className="text-xl font-semibold text-gray-900">
              {renderInline(b.content)}
            </h1>
          );

        if (b.type === "h2")
          return (
            <h2 key={i} className="text-base font-semibold text-gray-900 pt-2">
              {renderInline(b.content)}
            </h2>
          );

        if (b.type === "h3")
          return (
            <h3 key={i} className="text-sm font-semibold text-gray-900 pt-1">
              {renderInline(b.content)}
            </h3>
          );

        if (b.type === "ul") {
          const nested = nestOneLevel(b.items);
          return (
            <ul key={i} className="list-disc pl-5 space-y-1 text-sm text-gray-800">
              {nested.map((it, j) => (
                <li key={j}>
                  {renderInline(it.text)}
                  {it.children?.length ? (
                    <ul className="list-[circle] pl-5 mt-1 space-y-1">
                      {it.children.map((c, k) => (
                        <li key={k}>{renderInline(c.text)}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={i} className="text-sm text-gray-800 leading-relaxed">
            {renderInline(b.content)}
          </p>
        );
      })}
    </div>
  );
}

export default function MobileAppUserGuidePage() {
  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900">User Guide</div>
          <Link
            href="/m"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold shadow-sm active:bg-gray-50"
          >
            Home
          </Link>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
          <Markdown text={guide} />
        </div>
      </main>
    </div>
  );
}