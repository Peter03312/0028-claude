import {
  validateToken,
  tokenizeNotation,
  parseStart,
  parseRounds,
  runPlan,
} from './core/verifier.js';

const MAX_STEPS = 1_000_000;
const MAX_RENDERED_ROWS = 20_000;

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
};

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
  els.conflictDetail.appendChild(first);

  const second = document.createElement('div');
  second.className = 'conflict-row';
  second.textContent = `② ${locationText(
    conflict.secondLocation,
    tokenCount,
  )}（行号 ${conflict.secondIndex}）：${formatRow(conflict.row)}`;
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

function renderTrace(result) {
  els.traceBody.innerHTML = '';
  const shown = result.trace.slice(0, MAX_RENDERED_ROWS + 1);
  const frag = document.createDocumentFragment();
  for (const entry of shown) {
    const tr = document.createElement('tr');
    tr.className = rowClass(entry, result);
    const cells = [
      String(entry.index),
      entry.index === 0 ? '—' : `第 ${entry.round} 轮`,
      entry.index === 0 ? '起始' : `${entry.stepInRound}/${result.tokens.length}`,
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
  els.traceBody.appendChild(frag);

  if (result.totalSteps > MAX_RENDERED_ROWS) {
    els.traceSummary.textContent =
      `共生成 ${result.totalSteps + 1} 行；为保持流畅，仅展示前 ${
        MAX_RENDERED_ROWS + 1
      } 行（冲突判定仍基于全部行）。`;
  } else {
    els.traceSummary.textContent = `共 ${result.totalSteps + 1} 行（含起始行）。`;
  }
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
