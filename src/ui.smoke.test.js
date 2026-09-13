// @vitest-environment jsdom
//
// 界面冒烟测试：用真实 index.html 装配 jsdom，加载 src/main.js，
// 模拟输入与点击，验证错误定位、判定横幅、首次冲突与逐行轨迹的真实渲染。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

const dom = new JSDOM(html, { url: 'http://localhost/' });

beforeAll(async () => {
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  // 触发 main.js 顶层装配
  await import('./main.js');
});

function setValue(id, value) {
  const el = document.getElementById(id);
  el.value = value;
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function clickVerify() {
  document
    .getElementById('verify-btn')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

describe('界面装配与验真交互', () => {
  it('页面包含全部输入与结果区域', () => {
    for (const id of [
      'stage',
      'start',
      'notation',
      'rounds',
      'token-strip',
      'verdict',
      'trace-table',
      'conflict-box',
    ]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('合法闭合：横幅为真·闭合，轨迹含起始行与全部换位行', () => {
    setValue('stage', '4');
    setValue('start', '1 2 3 4');
    setValue('notation', 'x 14 x 12 x 14 x 34');
    setValue('rounds', '3');
    clickVerify();

    const verdict = document.getElementById('verdict');
    expect(verdict.classList.contains('closed')).toBe(true);
    expect(verdict.textContent).toMatch(/真 · 闭合/);
    expect(document.getElementById('errors').classList.contains('hidden')).toBe(
      true,
    );
    expect(
      document.getElementById('conflict-box').classList.contains('hidden'),
    ).toBe(true);

    const rows = document.querySelectorAll('#trace-table tbody tr');
    expect(rows.length).toBe(25); // 起始行 + 8*3 个换位
    expect(rows[24].textContent).toContain('1 2 3 4');
  });

  it('跨轮重复：判假并展示首次冲突的两处位置与同一排列', () => {
    setValue('notation', 'x 12 x');
    setValue('rounds', '2');
    clickVerify();

    const verdict = document.getElementById('verdict');
    expect(verdict.classList.contains('false')).toBe(true);

    const detail = document.getElementById('conflict-detail').textContent;
    expect(detail).toMatch(/第 1 轮/);
    expect(detail).toMatch(/第 2 轮/);
    expect(detail).toMatch(/2 1 3 4/);

    // 轨迹中两行冲突行被高亮
    const dupRows = document.querySelectorAll(
      '#trace-table tbody tr.row-dup',
    );
    expect(dupRows.length).toBe(2);
  });

  it('提前闭合：说明中途回到起始行', () => {
    setValue('notation', 'x 14');
    setValue('rounds', '5');
    clickVerify();

    expect(
      document.getElementById('verdict').classList.contains('false'),
    ).toBe(true);
    expect(document.getElementById('conflict-detail').textContent).toMatch(
      /提前闭合/,
    );
  });

  it('未闭合：横幅为未闭合，无冲突框', () => {
    setValue('notation', 'x 12 x');
    setValue('rounds', '1');
    clickVerify();

    expect(
      document.getElementById('verdict').classList.contains('open'),
    ).toBe(true);
    expect(
      document.getElementById('conflict-box').classList.contains('hidden'),
    ).toBe(true);
  });

  it('错误定位：奇数钟 x 与孤立未置位区段在记谱处标记并阻止验真', () => {
    setValue('stage', '5');
    setValue('start', '1 2 3 4 5');
    setValue('notation', 'x 12');
    setValue('rounds', '1');
    clickVerify();

    const errors = document.getElementById('errors');
    expect(errors.classList.contains('hidden')).toBe(false);
    expect(errors.textContent).toMatch(/偶数钟/);
    expect(errors.textContent).toMatch(/孤立/);

    // token 条上有两个红色 chip
    expect(document.querySelectorAll('.token-chip.bad').length).toBe(2);
    // 出现语法/配对问题时不展示结果
    expect(document.getElementById('result').classList.contains('hidden')).toBe(
      true,
    );
  });

  it('语法错误（非递增、越界）逐 token 定位', () => {
    setValue('stage', '4');
    setValue('start', '1 2 3 4');
    setValue('notation', '42 5');
    setValue('rounds', '1');
    clickVerify();

    const errors = document.getElementById('errors').textContent;
    expect(errors).toMatch(/严格递增/);
    expect(errors).toMatch(/越界/);
  });
});
