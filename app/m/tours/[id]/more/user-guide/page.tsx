"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import MobileNav from "../../_components/MobileNav";

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function MobileAppUserGuidePage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-24">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">
            Missing or invalid tour id in route.
            <div className="mt-2">
              <Link className="underline" href="/m">
                Go to mobile home
              </Link>
            </div>
          </div>
        </div>
        <MobileNav />
      </div>
    );
  }

  const guide = `How to Use the Golf Tour App (Mobile)

This app is designed to manage a multi-round golf tour, record hole-by-hole scores, calculate Stableford points, and automatically adjust playing handicaps between rounds using a defined rehandicapping rule.

The mobile app is optimised for on-course use and for reviewing results, while setup and configuration are handled through admin pages.

App Structure Overview

On mobile, each tour is organised into the following main sections:

- Rounds
- Scoring
- Leaderboards
- Competitions
- Stats
- More

Each section has a specific purpose, described below.

1. Rounds

Purpose
Shows all rounds that belong to the tour, in order.

What you see
- One card per round (e.g. R1, R2, R3)
- Course name
- Round date (if set)
- Status indicators (e.g. open / locked)

From a round you can access
- Scoring
- Results
- Tee Times

Important notes
- Players cannot be added to or removed from a round on mobile.
- Only players already marked as playing = true for the round can be scored.

2. Scoring

Purpose
Entry point for entering scores during a round.

How it works
1. Select a round.
2. Choose Me (required).
3. Optionally choose a Buddy.
4. Continue to the score entry screen.

Rules
- Only players marked as playing for the round can be selected.
- Buddy selection is optional and for convenience only.

2.1 Score Entry (Hole-by-Hole)

Purpose
Enter scores while playing.

Key features
- One hole shown at a time.
- Swipe left / right to move between holes.
- Large + / − buttons to adjust strokes.
- P button to mark a pickup.
- Tap PAR to set strokes equal to par instantly.

Displayed information
- Hole number
- Par and Stroke Index (SI)
- Playing Handicap (PH)
- Stableford points for the hole

Saving
- Tap Save (Me) to save your scores.
- Only Me is saved.
- Buddy scores are not saved.

Automatic behaviour
- Saving scores automatically triggers rehandicapping for the tour.
- Updated playing handicaps are applied to subsequent rounds.

2.2 Entry and Summary Tabs

At the top of the scoring screen are two tabs:

Entry
- Used for entering strokes hole by hole.

Summary
- Shows a full 18-hole table for a selected player.
- Displays:
  - Hole
  - Par
  - Stroke Index
  - Strokes (colour-coded)
  - Stableford points
- Front 9, Back 9, and Total subtotals are shown.
- Tap a hole number to return to entry for that hole.

3. Results

Purpose
Review results for a round.

What you see
- A list of players with totals.
- Tap a player to see:
  - Hole-by-hole scores
  - Stableford points for each hole

Results reflect:
- Saved scores only
- The playing handicaps in effect for that round

4. Leaderboards

Purpose
Show standings across the tour or for a specific competition.

4.1 Individual Leaderboards

What you see
- Player rankings
- Total points or scores (depending on competition)

Interaction
- Tap a player’s round score to see detailed results for that round:
  - Hole-by-hole breakdown
  - Stableford points
  - Par and Stroke Index reference

4.2 Pairs Leaderboards

What you see
- Pair rankings
- Aggregated or best-ball style results (depending on competition)

Interaction
- Tap a pair’s round score to drill into that round’s detail.
- Shows the underlying individual scores that contributed to the pair result.

This allows full transparency from leaderboard position down to hole-level scoring.

5. Competitions

Purpose
Display special tour competitions.

Examples
- Napoleon (Par 3 / 4 / 5 averages)
- Eclectic
- Other derived Stableford-based competitions

Navigation
- Tap a competition to see rankings.
- Where applicable, tap into a player to see contributing holes or rounds.

6. Stats

Purpose
Provide performance insights across the tour.

Examples of stats
- Average Stableford by par
- Percentage of birdies or better
- Percentage of zero-point holes
- Other performance measures

Stats are read-only and update automatically as scores are saved.

7. More

The More section contains tour information and administrative tools.

7.1 Tour Details

Purpose
Read-only overview of the tour.

Includes
- Tour name and dates
- Rehandicapping status
- Rehandicapping rule summary

No editing is possible on mobile in this section.

7.2 Rehandicapping

Purpose
Explain how handicaps are adjusted.
Show how handicaps change round by round.

What you see
- The rehandicapping rule in plain English.
- A table showing:
  - Each player
  - Their playing handicap for each round
  - Their starting handicap (fallback reference)

Behaviour
- This page refreshes automatically when revisited.
- Values always reflect the latest recalculation from:
  - score saves, or
  - starting handicap changes.

7.3 Tour Admin

Purpose
Manage tour-level configuration.

Starting Handicaps
- Edit each player’s tour starting handicap.
- Leaving a value blank uses the player’s global handicap.
- Saving:
  - Updates the tour starting handicap
  - Automatically recalculates playing handicaps for all rounds

Course Par & Stroke Index (Global)
- Select a course used in the tour.
- Edit Par and Stroke Index for:
  - Men’s tees (M)
  - Women’s tees (F)
- One row per hole (1–18).
- All fields are dropdown-based.

Validation
- Par must be 3, 4, or 5.
- Stroke Index must be unique from 1 to 18 for each tee.

Saving updates the global course data, affecting all tours that use that course.

Rehandicapping Rule (Plain English)

After each completed round, the Playing Handicap (PH) for the next round is recalculated using Stableford results.

The rounded average Stableford score for the round is calculated across all players who completed the round. Each player’s Stableford score is compared to this average, and the difference is multiplied by one-third. The result is rounded to the nearest whole number, with .5 rounding up, and applied as an adjustment to the player’s PH.

The resulting Playing Handicap cannot exceed Starting Handicap + 3, and cannot be lower than half the Starting Handicap, rounded up if the Starting Handicap is odd.

If a player does not play a round, their Playing Handicap carries forward unchanged to the next round.
`;

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-900">App User Guide</div>
            <div className="truncate text-sm text-gray-500">Tour</div>
          </div>

          <Link
            href={`/m/tours/${tourId}/more`}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm active:bg-gray-50"
          >
            Back
          </Link>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-4">
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{guide}</div>
        </section>
      </main>

      <MobileNav />
    </div>
  );
}
