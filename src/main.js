import {
  validateToken,
  tokenizeNotation,
  parseStart,
  parseRounds,
  runPlan,
} from './core/verifier.js';

const MAX_STEPS = 1_000_000;
const PAGE_SIZE = 500;

const els = {
  stage: document.getElementById('stage'),
  start: document.getElementById('start'),
  notation: document.getElementById('notation'),
  rounds: document.getElementById('rounds'),
  strip: document.getElementById('token-strip'),
  verifyBtn: document.getElementById('verify-btn'),
  errors: document.getElementById('errors'),
  result: document.getElementById('result'),
  verdict: document.getElementById('verdict'),
  conflictBox: document.getElementById('conflict-box'),
  conflictDetail: document.getElementById('conflict-detail'),
  traceSummary: document.getElementById('trace-summary'),
  traceBody: document.querySelector('#trace-table tbody'),
  pagerTop: document.getElementById('trace-pager-top'),
  pagerBottom: document.getElementById('trace-pager-bottom'),
};

// 最近一次验真结果与当前轨迹页（完整轨迹保留在内存中，分页只是视图）
let currentResult = null;
let currentPage = 1;

function identityStart(n) {
  return Array.from({ length: n }, (_, i) => i + 1).join(' ');
}

function formatRow(row) {
  return row.join(' ');
}

/** 实时在记谱处定位非法 token。 */
function renderTokenStrip() {
  const stage = Number(els.stage.value);
  const items = tokenizeNotation(els.notation.value);
  els.strip.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'hint';
    empty.textContent = '记谱为空时无法构成计划。';
    els.strip.appendChild(empty);
    return;
  }
  for (const item of items) {
    const result = validateToken(item.token, stage);
    const chip = document.createElement('span');
    chip.className = result.ok ? 'token-chip' : 'token-chip bad';
    const code = document.createElement('code');
    code.textContent = item.token;
    chip.appendChild(code);
    if (!result.ok) {
      const msg = document.createElement('span');
      msg.className = 'chip-msg';
      msg.textContent = result.message;
      chip.appendChild(msg);
    }
    els.strip.appendChild(chip);
  }
}

function showErrors(errors) {
  els.result.classList.add('hidden');
  els.errors.innerHTML = '';
  const title = document.createElement('h2');
  title.textContent = '输入存在问题，未执行验真';
  els.errors.appendChild(title);
  const ul = document.createElement('ul');
  for (const err of errors) {
    const li = document.createElement('li');
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = `${err.where}：`;
    li.appendChild(where);
    li.appendChild(document.createTextNode(err.message));
    ul.appendChild(li);
  }
  els.errors.appendChild(ul);
  els.errors.classList.remove('hidden');
}

function hideErrors() {
  els.errors.classList.add('hidden');
}

const VERDICT_TEXT = {
  closed: '真 · 闭合：计划终点首次回到起始行，此前无任何重复行。',
  false: '假：计划执行中出现重复行（含提前回到起始行）。',
  open: '未闭合：全程无重复行，但计划终点不是起始行。',
};

function locationText(loc, tokenCount) {
  if (loc.round === 0) return '起始行';
  return `第 ${loc.round} 轮 · 第 ${loc.stepInRound}/${tokenCount} 个换位`;
}

function renderConflict(conflict, tokenCount) {
  if (!conflict) {
    els.conflictBox.classList.add('hidden');
    return;
  }
  els.conflictBox.classList.remove('hidden');
  els.conflictDetail.innerHTML = '';

  const intro = document.createElement('p');
  const isEarlyClose = conflict.firstIndex === 0;
  if (isEarlyClose) {
    intro.textContent = `提前闭合：在 ${locationText(
      conflict.secondLocation,
      tokenCount,
    )} 就回到了起始行，计划尚未执行完，计划长度失效，该位置构成重复。`;
  } else {
    const crossRound =
      conflict.firstLocation.round !== conflict.secondLocation.round;
    intro.textContent = crossRound
      ? `同一钟位行在两处出现，且两处分属第 ${conflict.firstLocation.round} 轮与第 ${conflict.secondLocation.round} 轮（重复行可能跨记谱轮次才出现）。`
      : `同一钟位行在第 ${conflict.firstLocation.round} 轮内两处重复出现。`;
  }
  els.conflictDetail.appendChild(intro);

  const first = document.createElement('div');
  first.className = 'conflict-row';
  first.textContent = `① ${locationText(
    conflict.firstLocation,
    tokenCount,
  )}（行号 ${conflict.firstIndex}）：${formatRow(conflict.row)}`;
  first.appendChild(
    makeLocateButton('在轨迹中定位', conflict.firstIndex),
  );
  els.conflictDetail.appendChild(first);

  const second = document.createElement('div');
  second.className = 'conflict-row';
  second.textContent = `② ${locationText(
    conflict.secondLocation,
    tokenCount,
  )}（行号 ${conflict.secondIndex}）：${formatRow(conflict.row)}`;
  second.appendChild(
    makeLocateButton('在轨迹中定位', conflict.secondIndex),
  );
  els.conflictDetail.appendChild(second);
}

function rowClass(entry, result) {
  const classes = [];
  if (entry.index === 0) classes.push('row-start');
  if (entry.index === result.totalSteps) classes.push('row-endpoint');
  if (
    result.conflict &&
    (entry.index === result.conflict.firstIndex ||
      entry.index === result.conflict.secondIndex)
  ) {
    classes.push('row-dup');
  }
  return classes.join(' ');
}

function jumpToRowIndex(index) {
  if (!currentResult) return;
  if (index < 0 || index > currentResult.totalSteps) return;
  currentPage = Math.floor(index / PAGE_SIZE) + 1;
  renderTracePage();
  document
    .getElementById('trace-panel')
    ?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
}

function makeLocateButton(label, rowIndex) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pager-btn pager-locate';
  btn.textContent = label;
  btn.addEventListener('click', () => jumpToRowIndex(rowIndex));
  return btn;
}

function renderTracePage() {
  if (!currentResult) return;
  const { trace } = currentResult;
  const pageCount = Math.max(1, Math.ceil(trace.length / PAGE_SIZE));
  if (currentPage > pageCount) currentPage = pageCount;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, trace.length);

  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i += 1) {
    const entry = trace[i];
    const tr = document.createElement('tr');
    tr.id = `trace-row-${entry.index}`;
    tr.className = rowClass(entry, currentResult);
    const cells = [
      String(entry.index),
      entry.index === 0 ? '—' : `第 ${entry.round} 轮`,
      entry.index === 0
        ? '起始'
        : `${entry.stepInRound}/${currentResult.tokens.length}`,
      entry.index === 0 ? '—' : entry.token,
      formatRow(entry.row),
    ];
    for (const text of cells) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    frag.appendChild(tr);
  }
  els.traceBody.innerHTML = '';
  els.traceBody.appendChild(frag);
  renderPager(pageCount);

  els.traceSummary.textContent =
    `共 ${trace.length} 行（含起始行）；当前第 ${currentPage}/${pageCount} 页，` +
    `显示行 ${start}–${end - 1}（每页 ${PAGE_SIZE} 行，全部行均可翻页复核）。`;
}

function makePagerButton(text, target, opts = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pager-btn';
  btn.textContent = text;
  if (opts.disabled) {
    btn.disabled = true;
  }
  if (opts.onClick) {
    btn.addEventListener('click', opts.onClick);
  } else if (typeof target === 'number') {
    btn.addEventListener('click', () => {
      currentPage = target;
      renderTracePage();
    });
  }
  return btn;
}

function makeQuickJump(label, rowIndex) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pager-btn pager-jump';
  btn.textContent = label;
  btn.addEventListener('click', () => jumpToRowIndex(rowIndex));
  return btn;
}

function renderPager(pageCount) {
  for (const host of [els.pagerTop, els.pagerBottom]) {
    host.innerHTML = '';
    if (pageCount <= 1) {
      host.classList.add('hidden');
      continue;
    }
    host.classList.remove('hidden');

    host.appendChild(
      makePagerButton('« 首页', 1, { disabled: currentPage === 1 }),
    );
    host.appendChild(
      makePagerButton('‹ 上一页', currentPage - 1, {
        disabled: currentPage === 1,
      }),
    );

    // 页号：当前页前后各 2 页，外加首末页
    const pageNums = new Set([
      1,
      pageCount,
      currentPage - 2,
      currentPage - 1,
      currentPage,
      currentPage + 1,
      currentPage + 2,
    ]);
    let last = 0;
    for (const p of [...pageNums].filter((n) => n >= 1 && n <= pageCount)
      .sort((a, b) => a - b)) {
      if (p - last > 1) {
        const gap = document.createElement('span');
        gap.className = 'pager-gap';
        gap.textContent = '…';
        host.appendChild(gap);
      }
      const btn = makePagerButton(String(p), p);
      if (p === currentPage) {
        btn.classList.add('pager-current');
        btn.disabled = true;
      }
      host.appendChild(btn);
      last = p;
    }

    host.appendChild(
      makePagerButton('下一页 ›', currentPage + 1, {
        disabled: currentPage === pageCount,
      }),
    );
    host.appendChild(
      makePagerButton('末页 »', pageCount, {
        disabled: currentPage === pageCount,
      }),
    );

    const jumpWrap = document.createElement('span');
    jumpWrap.className = 'pager-goto';
    jumpWrap.appendChild(document.createTextNode('转到第 '));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = String(pageCount);
    input.value = String(currentPage);
    input.className = 'pager-input';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const p = Number(input.value);
        if (Number.isInteger(p) && p >= 1 && p <= pageCount) {
          currentPage = p;
          renderTracePage();
        }
      }
    });
    jumpWrap.appendChild(input);
    jumpWrap.appendChild(document.createTextNode(` / ${pageCount} 页`));
    host.appendChild(jumpWrap);

    // 关键行快捷跳转
    const quick = document.createElement('span');
    quick.className = 'pager-quick';
    quick.appendChild(makeQuickJump('起始行', 0));
    if (currentResult.conflict) {
      quick.appendChild(
        makeQuickJump('冲突①', currentResult.conflict.firstIndex),
      );
      quick.appendChild(
        makeQuickJump('冲突②', currentResult.conflict.secondIndex),
      );
    }
    quick.appendChild(makeQuickJump('终点', currentResult.totalSteps));
    host.appendChild(quick);
  }
}

function renderTrace(result) {
  currentResult = result;
  currentPage = 1;
  renderTracePage();
}

function verify() {
  const stage = Number(els.stage.value);
  const errors = [];

  const startResult = parseStart(els.start.value, stage);
  if (!startResult.ok) {
    errors.push({ where: '起始排列', message: startResult.message });
  }

  const roundsResult = parseRounds(els.rounds.value);
  if (!roundsResult.ok) {
    errors.push({ where: '计划重复轮数', message: roundsResult.message });
  }

  const items = tokenizeNotation(els.notation.value);
  if (items.length === 0) {
    errors.push({
      where: '记谱',
      message: '记谱为空：请至少输入一个合法 token',
    });
  }

  const legalTokens = [];
  items.forEach((item, i) => {
    const check = validateToken(item.token, stage);
    if (check.ok) {
      legalTokens.push(item.token);
    } else {
      const kind = check.code === 'syntax' ? '语法错误' : '配对错误';
      errors.push({
        where: `记谱第 ${i + 1} 个 token“${item.token}”（原文第 ${
          item.start + 1
        }–${item.end} 字符，${kind}）`,
        message: check.message,
      });
    }
  });

  if (roundsResult.ok && items.length > 0) {
    const total = items.length * roundsResult.rounds;
    if (total > MAX_STEPS) {
      errors.push({
        where: '计划长度',
        message: `计划共 ${total} 个换位，超过 ${MAX_STEPS.toLocaleString()} 步上限，请缩小重复轮数`,
      });
    }
  }

  renderTokenStrip();

  if (errors.length > 0) {
    showErrors(errors);
    return;
  }
  hideErrors();

  const result = runPlan({
    stage,
    start: startResult.row,
    tokens: legalTokens,
    rounds: roundsResult.rounds,
  });

  els.verdict.className = `verdict ${result.verdict}`;
  els.verdict.textContent = VERDICT_TEXT[result.verdict];
  renderConflict(result.conflict, legalTokens.length);
  renderTrace(result);
  els.result.classList.remove('hidden');
}

els.verifyBtn.addEventListener('click', verify);
els.notation.addEventListener('input', renderTokenStrip);
els.stage.addEventListener('change', () => {
  // 仅当当前起始排列仍是上一口钟的顺序行时，才跟随钟数更新，避免覆盖用户输入。
  const prevN = Number(els.start.value.split(/\s+/).filter(Boolean).length);
  const current = els.start.value.trim();
  if (current === identityStart(prevN) || current === '') {
    els.start.value = identityStart(Number(els.stage.value));
  }
  renderTokenStrip();
});
els.notation.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    verify();
  }
});

renderTokenStrip();
