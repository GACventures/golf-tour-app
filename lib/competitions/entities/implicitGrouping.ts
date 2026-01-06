export type PairingMode = "SEQUENTIAL" | "SNAKE";
export type TeamMode = "ROUND_ROBIN" | "SNAKE_TEAMS";

export type PlayerForGrouping = {
  id: string;
  name: string;
};

export type ImplicitGroup = {
  id: string; // e.g. "implicit:pair:0"
  name: string; // display name
  memberPlayerIds: string[];
};

export function makeImplicitPairs(params: {
  players: PlayerForGrouping[];
  mode: PairingMode;
}): ImplicitGroup[] {
  const { players, mode } = params;

  const pairs: ImplicitGroup[] = [];
  const n = players.length;

  const taken = new Array<boolean>(n).fill(false);

  const takeNextUntaken = () => {
    for (let i = 0; i < n; i++) if (!taken[i]) return i;
    return -1;
  };

  const takeLastUntaken = () => {
    for (let i = n - 1; i >= 0; i--) if (!taken[i]) return i;
    return -1;
  };

  let idx = 0;
  while (true) {
    const aIdx = takeNextUntaken();
    if (aIdx === -1) break;
    taken[aIdx] = true;

    let bIdx = -1;
    if (mode === "SEQUENTIAL") {
      bIdx = takeNextUntaken();
    } else {
      // SNAKE
      bIdx = takeLastUntaken();
    }

    if (bIdx !== -1) taken[bIdx] = true;

    const members = [players[aIdx].id].concat(bIdx !== -1 ? [players[bIdx].id] : []);
    const label =
      members.length === 2
        ? `${players[aIdx].name} / ${players[bIdx].name}`
        : `${players[aIdx].name} / (Solo)`;

    pairs.push({
      id: `implicit:pair:${idx}`,
      name: label,
      memberPlayerIds: members,
    });
    idx++;
  }

  return pairs;
}

export function makeImplicitTeams(params: {
  players: PlayerForGrouping[];
  teamCount: number;
  mode: TeamMode;
}): ImplicitGroup[] {
  const { players, teamCount, mode } = params;

  const k = Math.max(1, Math.floor(teamCount || 1));
  const buckets: PlayerForGrouping[][] = Array.from({ length: k }, () => []);

  if (mode === "ROUND_ROBIN") {
    for (let i = 0; i < players.length; i++) {
      buckets[i % k].push(players[i]);
    }
  } else {
    // SNAKE_TEAMS
    let dir = 1;
    let t = 0;
    for (let i = 0; i < players.length; i++) {
      buckets[t].push(players[i]);
      t += dir;
      if (t === k) {
        t = k - 1;
        dir = -1;
      } else if (t === -1) {
        t = 0;
        dir = 1;
      }
    }
  }

  return buckets.map((teamPlayers, idx) => {
    const memberIds = teamPlayers.map((p) => p.id);
    const name = `Team ${idx + 1}`;
    return {
      id: `implicit:team:${idx}`,
      name,
      memberPlayerIds: memberIds,
    };
  });
}
