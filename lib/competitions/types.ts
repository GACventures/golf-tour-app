export type CompetitionScope = "round" | "tour";

export type CompetitionKind = "individual" | "pair" | "team";

export type TeamSize = 2 | 3 | 4;

export type TieBreakRule =
  | "back9"
  | "front9"
  | "last6"
  | "last3"
  | "last1"
  | "countback" // generic “countback” preference
  | "none";

export type Eligibility = {
  /** include only players marked playing=true for the round(s) */
  onlyPlaying?: boolean;
  /** exclude players with incomplete scorecards (18 holes either number or P) */
  requireComplete?: boolean;
};

export type LeaderboardRow = {
  entryId: string; // playerId or synthetic team id
  label: string; // "Geoff" or "Geoff / Sam" or "Team A"
  total: number;

  // Optional breakdowns for display / tie-break
  front9?: number;
  back9?: number;

  // Optional per-hole totals (useful for team formats & countback)
  holeTotals?: number[]; // length 18

  // ✅ Many of your existing competitions return stats; keep typings aligned.
  stats?: Record<string, any>;
};

export type CompetitionResult = {
  competitionId: string;
  competitionName: string;
  kind: CompetitionKind;
  scope: CompetitionScope;
  rows: LeaderboardRow[];
};

export type PlayerLite = {
  id: string;
  name: string;
};

export type RoundPlayerLite = PlayerLite & {
  playing: boolean;
  playing_handicap: number;
};

export type HoleScore = {
  rawScore: string; // "", "P", "7"
};

export type ScoreMatrix = {
  // scores[playerId][holeIndex] -> raw string
  [playerId: string]: string[]; // length 18
};

export type CompetitionContext = {
  // Which holes exist (always 18 for now)
  holes: number[]; // [1..18]

  // Players in scope (round or tour slice)
  players: RoundPlayerLite[];

  // Raw score strings ("" | "P" | number string)
  scores: ScoreMatrix;

  // Pars + SI for net points
  parsByHole: number[]; // length 18
  strokeIndexByHole: number[]; // length 18

  // Helper: compute net Stableford points for a player on a hole
  netPointsForHole: (playerId: string, holeIndex: number) => number;

  // Helper: completeness check (18 holes done)
  isComplete: (playerId: string) => boolean;
};

export type CompetitionDefinition = {
  id: string;
  name: string;
  scope: CompetitionScope;
  kind: CompetitionKind;

  eligibility?: Eligibility;

  // For pairs/teams (Step 2). If kind is individual, ignore.
  teamSize?: TeamSize;

  // Compute leaderboard rows from context
  compute: (ctx: CompetitionContext) => LeaderboardRow[];

  // Sorting/tie-break config (can be expanded later)
  tieBreak?: TieBreakRule;
};
