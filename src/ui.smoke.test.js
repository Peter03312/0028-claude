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

  describe('长乐段分页：所有行都必须可逐行复核', () => {
    const pager = () => document.getElementById('trace-pager-top');
    const btnByText = (host, text) =>
      [...host.querySelectorAll('button')].find((b) =>
        b.textContent.includes(text),
      );

    it('超过单页时分页渲染，首页/上一页/下一页/末页逐行可达', () => {
      setValue('stage', '4');
      setValue('start', '1 2 3 4');
      // 1300 个换位 + 起始行 = 1301 行（每页 500 行 → 3 页）
      setValue('notation', 'x');
      setValue('rounds', '1300');
      clickVerify();

      expect(pager().classList.contains('hidden')).toBe(false);
      const rows = () =>
        document.querySelectorAll('#trace-table tbody tr');

      // 第 1 页：行 0–499
      expect(rows().length).toBe(500);
      expect(rows()[0].id).toBe('trace-row-0');
      expect(rows()[499].id).toBe('trace-row-499');

      // 下一页：行 500–999
      btnByText(pager(), '下一页').click();
      expect(rows().length).toBe(500);
      expect(rows()[0].id).toBe('trace-row-500');

      // 末页：行 1000–1300，最终行（终点）必须可见
      btnByText(pager(), '末页').click();
      expect(rows().length).toBe(301);
      expect(rows()[300].id).toBe('trace-row-1300');
      expect(rows()[300].textContent).toContain('1 2 3 4');

      // 上一页 / 首页
      btnByText(pager(), '上一页').click();
      expect(rows()[0].id).toBe('trace-row-500');
      btnByText(pager(), '首页').click();
      expect(rows()[0].id).toBe('trace-row-0');

      // 顶部与底部各有一个分页器
      expect(
        document.getElementById('trace-pager-bottom').classList.contains(
          'hidden',
        ),
      ).toBe(false);
    });

    it('“终点”快捷跳转直达最后一页并展示最终行', () => {
      btnByText(pager(), '终点').click();
      const rows = document.querySelectorAll('#trace-table tbody tr');
      expect(rows[300].id).toBe('trace-row-1300');
      expect(rows[300].textContent).toContain('1 2 3 4');
    });

    it('页码输入可转到任意页', () => {
      const input = pager().querySelector('.pager-input');
      input.value = '2';
      input.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
        }),
      );
      const rows = document.querySelectorAll('#trace-table tbody tr');
      expect(rows.length).toBe(500);
      expect(rows[0].id).toBe('trace-row-500');
      expect(
        document.getElementById('trace-summary').textContent,
      ).toMatch(/第 2\/3 页/);
    });

    it('冲突计划下提供冲突①②快捷跳转，且最终行仍可在末页复核', () => {
      // x 12 x 两轮（6 换位）在中途即冲突；这里重复 300 轮（900 换位）
      setValue('notation', 'x 12 x');
      setValue('rounds', '300');
      clickVerify();

      expect(
        document.getElementById('verdict').classList.contains('false'),
      ).toBe(true);
      const jump1 = btnByText(pager(), '冲突①');
      const jump2 = btnByText(pager(), '冲突②');
      expect(jump1).toBeTruthy();
      expect(jump2).toBeTruthy();

      jump1.click();
      let rows = document.querySelectorAll('#trace-table tbody tr');
      expect(
        document.getElementById('trace-row-2'),
      ).not.toBeNull(); // 首次位置：第 1 轮第 2 个换位后的 2134

      jump2.click();
      rows = document.querySelectorAll('#trace-table tbody tr');
      expect(
        document.getElementById('trace-row-4'),
      ).not.toBeNull();

      // 即使已有冲突，末页仍可复核最终行
      btnByText(pager(), '末页').click();
      rows = document.querySelectorAll('#trace-table tbody tr');
      expect(rows[rows.length - 1].id).toBe('trace-row-900');
    });

    it('短乐段不显示分页器', () => {
      setValue('notation', 'x 14 x 12 x 14 x 34');
      setValue('rounds', '3');
      clickVerify();
      expect(pager().classList.contains('hidden')).toBe(true);
      expect(
        document.querySelectorAll('#trace-table tbody tr').length,
      ).toBe(25);
    });
  });
});
