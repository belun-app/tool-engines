/**
 * Line-by-line diff of two texts by longest common subsequence, with counts of added,
 * removed and unchanged lines.
 */

export type DiffLineType = "equal" | "added" | "removed";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  equal: number;
}

const MAX_LINES = 2000;

function buildLcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

function backtrack(dp: number[][], a: string[], b: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: "equal", text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", text: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", text: a[i - 1] });
      i--;
    }
  }
  return result;
}

export function diffTexts(textA: string, textB: string): DiffResult {
  if (!textA && !textB) {
    return { lines: [], additions: 0, deletions: 0, equal: 0 };
  }

  // An empty text has no lines (split would give one empty line, a phantom deletion).
  const linesA = textA === "" ? [] : textA.split("\n").slice(0, MAX_LINES);
  const linesB = textB === "" ? [] : textB.split("\n").slice(0, MAX_LINES);

  const dp = buildLcs(linesA, linesB);
  const lines = backtrack(dp, linesA, linesB);

  let additions = 0;
  let deletions = 0;
  let equal = 0;
  for (const l of lines) {
    if (l.type === "added") additions++;
    else if (l.type === "removed") deletions++;
    else equal++;
  }

  return { lines, additions, deletions, equal };
}
