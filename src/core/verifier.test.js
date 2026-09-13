import { describe, it, expect } from 'vitest';
import {
  validateToken,
  applyChange,
  tokenizeNotation,
  parseStart,
  parseRounds,
  runPlan,
} from './verifier.js';

describe('validateToken：单换位合法性', () => {
  it('偶数钟时 x 合法，奇数钟时 x 非法', () => {
    expect(validateToken('x', 4).ok).toBe(true);
    expect(validateToken('x', 6).ok).toBe(true);
    const odd = validateToken('x', 5);
    expect(odd.ok).toBe(false);
    expect(odd.code).toBe('odd-x');
    expect(odd.message).toMatch(/偶数钟/);
  });

  it('纯置位号：所有钟保持不动时合法', () => {
    expect(validateToken('1234', 4).ok).toBe(true);
  });

  it('合法置位 token：x/12/14/34 在四口钟均成对交换', () => {
    for (const token of ['x', '12', '14', '34']) {
      expect(validateToken(token, 4).ok).toBe(true);
    }
  });

  it('孤立未置位区段：奇数长度无法两两交换', () => {
    // 1 置位：位置 2–4 是长度 3 的孤立区段
    const one = validateToken('1', 4);
    expect(one.ok).toBe(false);
    expect(one.code).toBe('odd-run');
    expect(one.oddRuns).toEqual([[2, 4]]);

    // 2 置位：位置 1 是长度 1 的孤立区段
    const two = validateToken('2', 4);
    expect(two.ok).toBe(false);
    expect(two.code).toBe('odd-run');
    expect(two.oddRuns).toEqual([[1, 1]]);

    // 六口钟上 token 34：位置 1–2 成对，但位置 5–6 成对 → 合法；
    // token 3：位置 4–6 长度 3 孤立 → 非法
    expect(validateToken('34', 6).ok).toBe(true);
    const three = validateToken('3', 6);
    expect(three.ok).toBe(false);
    expect(three.code).toBe('odd-run');
    expect(three.oddRuns).toEqual([[4, 6]]);
  });

  it('语法错误：非 token、越界、重复、非递增', () => {
    expect(validateToken('y', 4).code).toBe('syntax');
    expect(validateToken('12x', 4).code).toBe('syntax');
    expect(validateToken('5', 4).code).toBe('syntax');
    expect(validateToken('0', 4).code).toBe('syntax');
    expect(validateToken('11', 4).code).toBe('syntax');
    expect(validateToken('42', 4).code).toBe('syntax');
  });

  it('奇数钟上也可用置位号构造合法/非法换位', () => {
    // 五口钟：1 置位 + 位置 2–3、4–5 成对
    expect(validateToken('1', 5).ok).toBe(true);
    // 12 置位：位置 3–5 长度 3 孤立 → 非法
    expect(validateToken('12', 5).ok).toBe(false);
    expect(validateToken('12', 5).code).toBe('odd-run');
  });
});

describe('applyChange：换位执行', () => {
  it('x 在四口钟上两两交换', () => {
    expect(applyChange([1, 2, 3, 4], 'x')).toEqual([2, 1, 4, 3]);
  });

  it('14 保持 1、4 位不动，交换 2、3', () => {
    expect(applyChange([1, 2, 3, 4], '14')).toEqual([1, 3, 2, 4]);
  });

  it('1234 为恒等换位', () => {
    expect(applyChange([1, 2, 3, 4], '1234')).toEqual([1, 2, 3, 4]);
  });
});

describe('起始排列与轮数解析', () => {
  it('起始排列必须是 1..N 各一次', () => {
    expect(parseStart('1 2 3 4', 4).ok).toBe(true);
    expect(parseStart('4321', 4).code).toBe('start-range');
    expect(parseStart('4 3 2 1', 4).ok).toBe(true);
    expect(parseStart('1 2 3', 4).code).toBe('start-length');
    expect(parseStart('1 2 3 3', 4).code).toBe('start-duplicate');
    expect(parseStart('1 2 3 5', 4).code).toBe('start-range');
    expect(parseStart('   ', 4).code).toBe('start-empty');
  });

  it('重复轮数必须为正整数', () => {
    expect(parseRounds('3').rounds).toBe(3);
    expect(parseRounds('').code).toBe('rounds-empty');
    expect(parseRounds('0').code).toBe('rounds-range');
    expect(parseRounds('1.5').code).toBe('rounds-syntax');
  });

  it('tokenizeNotation 记录原文偏移', () => {
    const items = tokenizeNotation('x  14 x');
    expect(items.map((i) => i.token)).toEqual(['x', '14', 'x']);
    expect(items[1]).toMatchObject({ start: 3, end: 5 });
  });
});

describe('runPlan：真伪闭合判定', () => {
  // Plain Bob Minimus 完整长记谱，3 轮共 24 个换位，终点恰好回到 1234
  const plainBob = ['x', '14', 'x', '12', 'x', '14', 'x', '34'];

  it('合法闭合：全程无重复，终点首次回到起始行', () => {
    const r = runPlan({
      stage: 4,
      start: [1, 2, 3, 4],
      tokens: plainBob,
      rounds: 3,
    });
    expect(r.verdict).toBe('closed');
    expect(r.conflict).toBeNull();
    expect(r.trace[r.trace.length - 1].row).toEqual([1, 2, 3, 4]);
    expect(r.totalSteps).toBe(24);
  });

  it('奇数钟 x：token 层直接拒绝（并由整段计划前置校验拦截）', () => {
    expect(validateToken('x', 5).code).toBe('odd-x');
  });

  it('孤立未置位区段：token 层标记 odd-run 并给出区段位置', () => {
    const check = validateToken('3', 6);
    expect(check.code).toBe('odd-run');
    expect(check.oddRuns).toEqual([[4, 6]]);
  });

  it('跨轮重复：首次冲突的两处位置分属不同轮次', () => {
    // x 12 x 执行两轮：第 1 轮第 2 个换位后的 2134，
    // 在第 2 轮第 1 个换位后再次出现。
    const r = runPlan({
      stage: 4,
      start: [1, 2, 3, 4],
      tokens: ['x', '12', 'x'],
      rounds: 2,
    });
    expect(r.verdict).toBe('false');
    expect(r.conflict).not.toBeNull();
    expect(r.conflict.firstLocation.round).toBe(1);
    expect(r.conflict.secondLocation.round).toBe(2);
    expect(r.conflict.firstIndex).toBe(2);
    expect(r.conflict.secondIndex).toBe(4);
    expect(r.conflict.row).toEqual([2, 1, 3, 4]);
  });

  it('提前闭合：计划中途回到起始行，计划长度失效', () => {
    // x 14 的轨道周期为 8 步（4 轮）；计划 5 轮（10 步）时，
    // 起始行在第 8 步提前出现，终点之前已经重复。
    const r = runPlan({
      stage: 4,
      start: [1, 2, 3, 4],
      tokens: ['x', '14'],
      rounds: 5,
    });
    expect(r.verdict).toBe('false');
    expect(r.conflict.firstIndex).toBe(0);
    expect(r.conflict.secondIndex).toBe(8);
    expect(r.conflict.secondIndex).toBeLessThan(r.totalSteps);
  });

  it('未闭合：无任何重复但终点不是起始行', () => {
    const r = runPlan({
      stage: 4,
      start: [1, 2, 3, 4],
      tokens: ['x', '12', 'x'],
      rounds: 1,
    });
    expect(r.verdict).toBe('open');
    expect(r.conflict).toBeNull();
    expect(r.trace[r.trace.length - 1].row.join('')).not.toBe('1234');
  });

  it('同轮内重复同样判为假（首次冲突即被捕获）', () => {
    // 恒等换位 1234：第 1 步立刻重复起始行；两轮计划下该重复不是终点
    const r = runPlan({
      stage: 4,
      start: [1, 2, 3, 4],
      tokens: ['1234'],
      rounds: 2,
    });
    expect(r.verdict).toBe('false');
    expect(r.conflict).not.toBeNull();
    expect([r.conflict.firstIndex, r.conflict.secondIndex]).toEqual([0, 1]);
  });

  it('闭合轨迹的每个排列都是 1..N 的合法排列', () => {
    const r = runPlan({
      stage: 4,
      start: [1, 2, 3, 4],
      tokens: plainBob,
      rounds: 3,
    });
    for (const entry of r.trace) {
      expect(entry.row.slice().sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4,
      ]);
    }
  });
});
