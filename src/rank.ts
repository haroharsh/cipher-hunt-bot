export interface RankedTeam {
  name: string;
  score: number;
  rank: number;
}

/** Score desc, then name asc. Equal scores share a rank (1,1,3...). */
export function rankTeams(teams: { name: string; score: number }[]): RankedTeam[] {
  const sorted = [...teams].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0;
  let prev: number | null = null;
  return sorted.map((t, i) => {
    if (t.score !== prev) {
      rank = i + 1;
      prev = t.score;
    }
    return { ...t, rank };
  });
}
