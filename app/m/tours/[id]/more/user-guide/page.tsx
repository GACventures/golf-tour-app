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

This app is designed to manage a multi-round golf tour, record hole-by-hole scores, calculate Stableford points, and automatically adjust playing handicaps between rounds using a defined rehandicapping rule (if rehandicapping is being used on the tour).

App Structure Overview

Each tour is organised into the following main sections:

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

What you can tap  
From a round card you can tap:  
- Scoring (to enter scores)  
- Results (to view score totals and hole-by-hole results)  
- Tee Times (to view playing groups / tee time groupings)

2. Scoring

Purpose  
Entry point for entering scores during a round.

How it works  
1. Select a round.  
2. Choose Me (required).  
3. Optionally choose a Buddy.  
4. Continue to the score entry screen.

Rules  
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
- Par and Stroke Index (SI) (shown for both Men’s and Women’s)  
- Playing Handicap (PH) (shown per player)  
- Stableford points for the hole

Saving  
- Tap Save (Me) to save your scores.  
- Only Me is saved.  
- Buddy scores are not saved.

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

Results reflect  
- Saved scores only  
- The playing handicaps in effect for that round

4. Leaderboards

Purpose  
Show standings across the tour or for specific competitions.

General interactions (applies across leaderboards)  
- Round scores shown in leaderboards are clickable.  
- Tapping a round score opens a detailed view showing how the score was built up hole by hole.

4.1 Individual Leaderboards

What you see  
- Player rankings  
- Total points or scores (depending on competition)

What you can tap  
- Tap a player’s round score to see detailed results for that round.

4.2 Pairs Leaderboards

What you see  
- Pair rankings  
- Aggregated or best-ball style results.

What you can tap  
- Tap a pair’s round score to drill into that round’s detail.

4.3 Teams Leaderboards

What you see  
- Team rankings  
- Team totals by round.

What you can tap  
- Tap a team’s round score to open the round calculation detail page.

5. Competitions

Purpose  
Display special tour competitions.

Examples  
- Napoleon  
- Eclectic  
- Hot Streak  
- Cold Streak  

5.1 Matchplay (Format / Results / Leaderboard)

Purpose  
Matchplay competitions run as head-to-head matches rather than total Stableford points.

A) Matchplay Format  
- Explains how matchplay works for the tour.

B) Matchplay Results  
- Shows completed match results.

C) Matchplay Leaderboard  
- Displays the overall matchplay standings.

6. Stats

Purpose  
Provide performance insights across the tour.

7. More

Contains tour information and administrative tools.

7.1 Tour Details  
Read-only overview of the tour.

7.2 Rehandicapping  
Explains how playing handicaps change round by round.

7.3 Tour Admin  
Manage starting handicaps, course par/SI, and rehandicapping rules.
`;

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-base font-semibold text-gray-900">App User Guide</div>
          <Link
            href={`/m/tours/${tourId}/more`}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
          >
            Back
          </Link>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {guide}
          </div>
        </section>
      </main>

      <MobileNav />
    </div>
  );
}
