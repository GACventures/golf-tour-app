// app/m/user-guide/page.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/**
 * ✅ UX:
 * - Header stays sticky (existing).
 * - Button grid is ALSO sticky below the header.
 * - The content scrolls underneath.
 * - Buttons are numbered and match the numbering in the text.
 * - Subsections (2.1, 2.2, 2.3 etc.) remain inside their parent sections.
 */

const overviewText = `
# How to Use the Golf Tour app

This app is designed to manage a multi-round golf tour, record hole-by-hole scores, calculate **Stableford** points, and automatically adjust playing handicaps between rounds (if rehandicapping is enabled for the tour).

The app is optimised for mobile use during play.
`;

const roundsText = `
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
`;

const scoringText = `
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

## 2.2 Score Summary

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

## 2.3 Getting to Score Summary via the TOTAL button

- Tapping TOTAL takes you directly to the Score Summary for that player.
- From Score Summary you can:
  - Review hole-by-hole scoring
  - Jump back to any hole
  - Return to Entry to continue scoring
`;

const resultsText = `
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
`;

const leaderboardsText = `
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
`;

const competitionsText = `
## 5. Competitions

### Purpose

Displays special tour competitions that run alongside standard Stableford scoring.

### How it works

The Competitions screen shows each player’s current result and rank for each competition. Some competitions can be tapped to see more detail.

---

## 5.1 Competitions and definitions

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
`;

const matchplayText = `
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
`;

const statsText = `
## 7. Stats

### Purpose

Provide performance insights across the tour.

Stats vary by tour setup and available data.
`;

const tourAdminText = `
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

const rehandicappingText = `
## 9. Rehandicapping (Admin)

### Purpose

Rehandicapping controls how each player’s **playing handicap** is set for each round of the tour.

There are three views under the Rehandicapping screen:

- Automatic rehandicapping
- Manual rehandicapping
- Handicaps by round

When you open the Rehandicapping screen, you will see only these buttons. Tap one to view that section.

---

## 9.1 Automatic rehandicapping

If Automatic rehandicapping is enabled, the app recalculates playing handicaps between rounds using the tour’s rehandicapping rule.

What happens when it is enabled:

- The app calculates a playing handicap for the next round after a round is completed.
- Players who do not play a round keep the same playing handicap for the next round.
- The “Handicaps by round” table will reflect the current calculated handicaps.

Notes:

- Turning Automatic on/off requires pressing **Save**.
- After saving, the app refreshes and the handicap table updates.

---

## 9.2 Rehandicapping rule

The Rehandicapping screen includes a plain-English description of the rule being used for Automatic rehandicapping.

This section is informational only — it explains how the app is adjusting playing handicaps when Automatic is enabled.

---

## 9.3 Manual rehandicapping

Manual rehandicapping is used when you want to override playing handicaps from a chosen round onward.

Important:

- Manual rehandicapping is only available when **Automatic rehandicapping is OFF**.

How it works:

1. Enable Manual rehandicapping.
2. Select the starting round (this is the first round that will be affected).
3. For a player:
   - Enter the playing handicap (whole number).
   - Tap **Apply forward** to apply that handicap from the selected round onward (inclusive).
   - Or tap **Reset forward** to restore that player to their starting handicap from the selected round onward.

Notes:

- Manual changes apply forward across rounds so you can correct a tour mid-stream without editing each round individually.
- Manual changes update the “Handicaps by round” view after saving.

---

## 9.4 Handicaps by round

This view shows the playing handicap used for each player in each round.

What you see:

- One row per player.
- A column showing the player’s **starting handicap (exact)**.
- One column per round showing the **playing handicap** for that round.

This is the best place to verify that rehandicapping (automatic or manual) has produced the expected handicaps across the tour.
`;

// ------- Minimal markdown renderer with nested bullet indentation -------

type Block =
  | { type: "h1" | "h2" | "h3" | "p" | "hr"; text?: string }
  | { type: "list"; items: ListItem[] };

type ListItem = { text: string; children: ListItem[] };

function countLeadingSpaces(s: string) {
  let n = 0;
  while (n < s.length && s[n] === " ") n++;
  return n;
}

function parseList(lines: string[], startIndex: number) {
  // Parses consecutive list lines into a nested list based on indentation.
  // Assumption: nested items are indented by >= 2 spaces.
  const root: ListItem[] = [];
  const stack: Array<{ indent: number; items: ListItem[] }> = [{ indent: -1, items: root }];

  let i = startIndex;

  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim()) break;

    const m = raw.match(/^(\s*)[-•]\s+(.+)$/);
    if (!m) break;

    const indent = countLeadingSpaces(m[1]);
    const text = m[2];

    // Find parent level
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();

    // If indent jumps deeper, ensure we nest under the last item
    if (indent > stack[stack.length - 1].indent) {
      const parentItems = stack[stack.length - 1].items;
      const last = parentItems[parentItems.length - 1];

      if (indent >= 2 && last) {
        // Nest under last
        stack.push({ indent, items: last.children });
      }
      // else: still treat as top-level
    }

    const target = stack[stack.length - 1].items;
    target.push({ text, children: [] });

    i++;
  }

  return { items: root, nextIndex: i };
}

function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.trim() === "---") {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const h1 = line.match(/^# (.+)$/);
    const h2 = line.match(/^## (.+)$/);
    const h3 = line.match(/^### (.+)$/);

    if (h1) {
      blocks.push({ type: "h1", text: h1[1] });
      i++;
      continue;
    }
    if (h2) {
      blocks.push({ type: "h2", text: h2[1] });
      i++;
      continue;
    }
    if (h3) {
      blocks.push({ type: "h3", text: h3[1] });
      i++;
      continue;
    }

    // List?
    if (/^\s*[-•]\s+/.test(line)) {
      const parsed = parseList(lines, i);
      blocks.push({ type: "list", items: parsed.items });
      i = parsed.nextIndex;
      continue;
    }

    // Paragraph
    blocks.push({ type: "p", text: line.trim() });
    i++;
  }

  const renderList = (items: ListItem[], level: number) => {
    // Level 0: disc, Level 1+: circle
    const bulletClass = level === 0 ? "list-disc" : "list-[circle]";
    const padClass = level === 0 ? "pl-5" : "pl-7";

    return (
      <ul className={`${bulletClass} ${padClass} space-y-1 text-sm text-gray-800`}>
        {items.map((it, idx) => (
          <li key={`${level}-${idx}`}>
            {it.text}
            {it.children.length ? <div className="mt-1">{renderList(it.children, level + 1)}</div> : null}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-3">
      {blocks.map((b, idx) => {
        if (b.type === "hr") return <div key={idx} className="h-px bg-gray-200 my-2" />;

        if (b.type === "h1")
          return (
            <h1 key={idx} className="text-xl font-semibold text-gray-900">
              {b.text}
            </h1>
          );

        if (b.type === "h2")
          return (
            <h2 key={idx} className="text-base font-semibold text-gray-900 pt-2">
              {b.text}
            </h2>
          );

        if (b.type === "h3")
          return (
            <h3 key={idx} className="text-sm font-semibold text-gray-900 pt-1">
              {b.text}
            </h3>
          );

        if (b.type === "list") return <div key={idx}>{renderList(b.items, 0)}</div>;

        return (
          <p key={idx} className="text-sm text-gray-800 leading-relaxed">
            {b.text}
          </p>
        );
      })}
    </div>
  );
}

type GuideSectionKey =
  | "overview"
  | "rounds"
  | "scoring"
  | "results"
  | "leaderboards"
  | "competitions"
  | "matchplay"
  | "stats"
  | "tourAdmin"
  | "rehandicapping"
  | null;

export default function MobileAppUserGuidePage() {
  const [active, setActive] = useState<GuideSectionKey>(null);

  const sections = useMemo(
    () =>
      [
        { key: "overview" as const, label: "Overview", text: overviewText },
        { key: "rounds" as const, label: "1. Rounds", text: roundsText },
        { key: "scoring" as const, label: "2. Scoring", text: scoringText },
        { key: "results" as const, label: "3. Results", text: resultsText },
        { key: "leaderboards" as const, label: "4. Leaderboards", text: leaderboardsText },
        { key: "competitions" as const, label: "5. Competitions", text: competitionsText },
        { key: "matchplay" as const, label: "6. Matchplay", text: matchplayText },
        { key: "stats" as const, label: "7. Stats", text: statsText },
        { key: "tourAdmin" as const, label: "8. Tour Admin", text: tourAdminText },
        { key: "rehandicapping" as const, label: "9. Rehandicapping", text: rehandicappingText },
      ] as const,
    []
  );

  const activeSection = active ? sections.find((s) => s.key === active) : null;

  const chooserBtnBase = "h-11 rounded-xl border text-xs font-semibold flex items-center justify-center px-2";
  const chooserBtnActive = "border-gray-900 bg-gray-900 text-white";
  const chooserBtnIdle = "border-gray-200 bg-white text-gray-900";

  function toggle(next: Exclude<GuideSectionKey, null>) {
    setActive((prev) => (prev === next ? null : next));
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-gray-200">
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

      {/* ✅ Sticky chooser below header */}
      <div className="sticky top-[49px] z-10 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            {sections.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                className={`${chooserBtnBase} ${active === s.key ? chooserBtnActive : chooserBtnIdle}`}
              >
                {s.label}
              </button>
            ))}

            {/* Pad to complete final row (keeps layout consistent) */}
            {sections.length % 3 === 1 ? (
              <>
                <div />
                <div />
              </>
            ) : sections.length % 3 === 2 ? (
              <div />
            ) : null}
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {activeSection ? (
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
            <Markdown text={activeSection.text} />
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 text-sm text-gray-700">
            Tap a section above to view the guide.
          </div>
        )}
      </main>
    </div>
  );
}