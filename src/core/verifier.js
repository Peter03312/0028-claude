// 变钟法换位谱核心验真逻辑（不依赖 DOM，可直接在测试中调用）
//
// 位置约定：钟与位置均以 1 起编号，内部数组以 0 起编号。
// 一个换位（token）的语义：置位号位置上的钟保持不动，
// 其余每个连续未置位区段必须为偶数长度，区段内从左到右两两交换。

/**
 * 校验单个 token 是否合法。
 * @param {string} token 记谱 token
 * @param {number} stage 钟数 N（4–8）
 * @returns {{ok: true, places: number[]} | {ok: false, code: string, message: string}}
 */
export function validateToken(token, stage) {
  const oddX =
    'x 仅在偶数钟时成立：当前钟数为奇数，无法让所有相邻钟两两交换';
  const badChar = `token 只能是 x 或由 1 至 ${stage} 的数字直接拼成`;

  if (token === 'x') {
    if (stage % 2 === 1) {
      return { ok: false, code: 'odd-x', message: oddX };
    }
    return { ok: true, places: [] };
  }

  if (!/^[1-8]+$/.test(token)) {
    return { ok: false, code: 'syntax', message: badChar };
  }

  const digits = token.split('').map((ch) => Number(ch));
  for (const d of digits) {
    if (d < 1 || d > stage) {
      return {
        ok: false,
        code: 'syntax',
        message: `位置号 ${d} 越界：只允许 1 至 ${stage}`,
      };
    }
  }

  for (let i = 1; i < digits.length; i += 1) {
    if (digits[i] === digits[i - 1]) {
      return {
        ok: false,
        code: 'syntax',
        message: `位置号 ${digits[i]} 重复出现`,
      };
    }
    if (digits[i] < digits[i - 1]) {
      return {
        ok: false,
        code: 'syntax',
        message: '位置号必须严格递增',
      };
    }
  }

  const places = new Set(digits);
  let runStart = 1;
  const oddRuns = [];
  for (let pos = 1; pos <= stage; pos += 1) {
    if (places.has(pos)) {
      if (runStart < pos && (pos - runStart) % 2 === 1) {
        oddRuns.push([runStart, pos - 1]);
      }
      runStart = pos + 1;
    }
  }
  if (runStart <= stage && (stage - runStart + 1) % 2 === 1) {
    oddRuns.push([runStart, stage]);
  }
  if (oddRuns.length > 0) {
    const runs = oddRuns
      .map(([a, b]) => (a === b ? `位置 ${a}` : `位置 ${a}–${b}`))
      .join('；');
    return {
      ok: false,
      code: 'odd-run',
      message: `孤立的奇数长度未置位区段（${runs}）无法两两交换`,
      oddRuns,
    };
  }

  return { ok: true, places: digits };
}

/**
 * 对当前钟位行施加一个合法换位。
 * @param {number[]} row 当前排列（1..N）
 * @param {string} token 已校验合法的 token
 * @returns {number[]} 新排列
 */
export function applyChange(row, token) {
  const next = row.slice();
  let held = new Set();
  if (token !== 'x') {
    held = new Set(token.split('').map((ch) => Number(ch)));
  }
  let i = 0;
  while (i < row.length) {
    const pos = i + 1;
    if (held.has(pos)) {
      i += 1;
    } else {
      const tmp = next[i];
      next[i] = next[i + 1];
      next[i + 1] = tmp;
      i += 2;
    }
  }
  return next;
}

/**
 * 按空白切分记谱并记录每个 token 在原文中的偏移（用于界面定位）。
 * @param {string} text
 * @returns {{token: string, start: number, end: number}[]}
 */
export function tokenizeNotation(text) {
  const result = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    result.push({ token: m[0], start: m.index, end: m.index + m[0].length });
  }
  return result;
}

/**
 * 解析起始排列。
 * @param {string} text
 * @param {number} stage
 * @returns {{ok: true, row: number[]} | {ok: false, code: string, message: string}}
 */
export function parseStart(text, stage) {
  const parts = text.split(/\s+/).filter((s) => s.length > 0);
  if (parts.length === 0) {
    return { ok: false, code: 'start-empty', message: '请输入起始排列' };
  }
  const row = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return {
        ok: false,
        code: 'start-syntax',
        message: `起始排列包含非数字项“${part}”`,
      };
    }
    const value = Number(part);
    if (value < 1 || value > stage) {
      return {
        ok: false,
        code: 'start-range',
        message: `起始排列中的 ${value} 不在 1 至 ${stage} 范围内`,
      };
    }
    if (row.includes(value)) {
      return {
        ok: false,
        code: 'start-duplicate',
        message: `起始排列中的 ${value} 重复出现`,
      };
    }
    row.push(value);
  }
  if (row.length !== stage) {
    return {
      ok: false,
      code: 'start-length',
      message: `起始排列必须恰好包含 ${stage} 个数字（当前 ${row.length} 个）`,
    };
  }
  return { ok: true, row };
}

/**
 * 解析计划重复轮数（含首轮）。
 * @param {string} text
 * @returns {{ok: true, rounds: number} | {ok: false, code: string, message: string}}
 */
export function parseRounds(text) {
  const trimmed = text.trim();
  if (trimmed === '') {
    return {
      ok: false,
      code: 'rounds-empty',
      message: '请输入计划重复轮数',
    };
  }
  if (!/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      code: 'rounds-syntax',
      message: '重复轮数必须为正整数',
    };
  }
  const rounds = Number(trimmed);
  if (rounds < 1) {
    return {
      ok: false,
      code: 'rounds-range',
      message: '重复轮数至少为 1（含首轮）',
    };
  }
  return { ok: true, rounds };
}

const keyOf = (row) => row.join('');

/**
 * 执行整段计划并判定真伪。
 * 调用前需保证 tokens 全部合法、起始排列合法且 rounds >= 1。
 *
 * 判定规则：
 *  - 计划终点首次回到起始行，且此前没有任何重复 → closed（真且闭合）
 *  - 任意其他重复（含提前回到起始行）→ false
 *  - 无重复但终点不同于起始行 → open（未闭合）
 *
 * @param {{stage: number, start: number[], tokens: string[], rounds: number}} input
 */
export function runPlan({ stage, start, tokens, rounds }) {
  const totalSteps = tokens.length * rounds;
  const trace = [{ round: 0, stepInRound: 0, index: 0, row: start.slice() }];
  const seen = new Map();
  seen.set(keyOf(start), 0);
  const startKey = keyOf(start);

  let row = start.slice();
  let conflict = null;

  for (let s = 1; s <= totalSteps; s += 1) {
    const token = tokens[(s - 1) % tokens.length];
    row = applyChange(row, token);
    trace.push({
      round: Math.floor((s - 1) / tokens.length) + 1,
      stepInRound: ((s - 1) % tokens.length) + 1,
      index: s,
      token,
      row: row.slice(),
    });

    // 计划终点回到起始行是闭合本身，不计为冲突；
    // 中途回到起始行（提前闭合）则使计划长度失效，判为假。
    if (s === totalSteps && keyOf(row) === startKey) {
      continue;
    }

    const key = keyOf(row);
    if (seen.has(key) && conflict === null) {
      const firstIndex = seen.get(key);
      conflict = {
        firstIndex,
        secondIndex: s,
        firstLocation: locationOf(firstIndex, tokens.length),
        secondLocation: locationOf(s, tokens.length),
        row: row.slice(),
      };
    } else {
      seen.set(key, s);
    }
  }

  const endpointKey = keyOf(row);

  let verdict;
  if (conflict === null && endpointKey === startKey) {
    verdict = 'closed';
  } else if (conflict !== null) {
    verdict = 'false';
  } else {
    verdict = 'open';
  }

  return { stage, start, tokens, rounds, totalSteps, trace, conflict, verdict };
}

function locationOf(index, tokenCount) {
  if (index === 0) {
    return { round: 0, stepInRound: 0, label: '起始行' };
  }
  const round = Math.floor((index - 1) / tokenCount) + 1;
  const stepInRound = ((index - 1) % tokenCount) + 1;
  return {
    round,
    stepInRound,
    label: `第 ${round} 轮第 ${stepInRound} 个换位`,
  };
}
