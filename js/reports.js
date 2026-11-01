// Reports tab: totals per kid and device, and the weekly bar chart.
import * as L from './logic.js';
import { store } from './store.js';
import { h, svg } from './ui.js';

const WEEKS = 8;
let endWeek = null; // week shown at the right edge of the chart
let paged = false; // once the user pages, stop following the newest data

export function renderReports() {
  const now = Date.now();
  const { state } = store;
  const withTime = (list, totalsFn) => list.filter((r) => !r.archived || totalsFn(state, r.id, now).all > 0);
  const kids = withTime(L.live(state.kids), L.kidTotals);
  const devices = withTime(L.live(state.devices), L.deviceTotals);
  const noEnd = L.countNoEnd(state);
  if (!kids.length) return h('p', { class: 'card empty muted' }, 'Add a kid to see reports.');

  return h('div', { class: 'stack-lg' },
    chartCard(kids, now),
    totalsCard('Totals per kid', kids, L.kidTotals, now),
    totalsCard('Totals per device', devices, L.deviceTotals, now),
    noEnd > 0 && h('p', { class: 'hint' }, `${noEnd} ${noEnd === 1 ? 'session' : 'sessions'} with no end time ${noEnd === 1 ? "isn't" : "aren't"} included. Add end times in History to count them.`));
}

function totalsCard(title, items, totalsFn, now) {
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, title),
    h('table', { class: 'table table-totals' },
      h('thead', {}, h('tr', {}, ['', 'Today', 'Week', 'Month', 'All'].map((c, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, c)))),
      h('tbody', {}, items.map((item) => {
        const t = totalsFn(store.state, item.id, now);
        return h('tr', {},
          h('th', { scope: 'row' }, item.name),
          [t.today, t.week, t.month, t.all].map((v) => h('td', { class: 'num' }, shortDuration(v))));
      }))));
}
/** Narrower than fmtDuration so four columns fit a phone: 2h04, 45m. */
function shortDuration(ms) {
  const total = Math.floor(ms / L.MIN);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return hours ? `${hours}h${String(mins).padStart(2, '0')}` : `${mins}m`;
}

function chartCard(kids, now) {
  const { state } = store;
  const latest = L.startOfWeek(now);
  const first = L.earliestWeek(state, now);
  if (!paged) endWeek = L.latestWeekWithData(state, now);
  const label = (t) => L.fmtDate(t, now);
  const shift = (d) => { paged = true; endWeek = L.addDays(endWeek, 7 * d); redraw(); };
  const body = h('div');
  const card = h('section', { class: 'card' }, body);

  function redraw() {
    const w = L.weeklySeries(store.state, kids, endWeek, WEEKS, now);
    body.replaceChildren(...[
      h('div', { class: 'chart-head' },
        h('h2', { class: 'card-title' }, 'Play time per week'),
        h('div', { class: 'pager' },
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Earlier weeks', disabled: L.addDays(endWeek, -7 * (WEEKS - 1)) <= first, onclick: () => shift(-WEEKS) }, '‹'),
          h('span', { class: 'pager-label' }, `${label(w[0].start)} – ${label(L.addDays(w[WEEKS - 1].start, 6))}`),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Later weeks', disabled: endWeek >= latest, onclick: () => { paged = true; endWeek = Math.min(latest, L.addDays(endWeek, 7 * WEEKS)); redraw(); } }, '›'))),
      kids.length > 1 && h('ul', { class: 'legend' }, kids.map((k) => h('li', {}, h('i', { class: `swatch ${seriesClass(k)}` }), k.name))),
      barChart(w, kids, now),
      h('details', { class: 'chart-table' },
        h('summary', {}, 'Show as table'),
        h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Week of'), kids.map((k) => h('th', { scope: 'col', class: 'num' }, k.name)))),
          h('tbody', {}, w.map((row) => h('tr', {},
            h('th', { scope: 'row' }, label(row.start)),
            kids.map((k) => h('td', { class: 'num' }, shortDuration(row.perKid[k.id])))))))),
    ].filter(Boolean));
  }
  redraw();
  return card;
}

const seriesClass = (kid) => (kid.colorIdx < 8 ? `s${kid.colorIdx + 1}` : 'sx');

function niceStep(maxHours) {
  for (const step of [1, 2, 5, 10, 20, 50, 100]) if (maxHours / step <= 4) return step;
  return 200;
}

function barChart(weeks, kids, now) {
  const width = Math.min(window.innerWidth - 56, 600);
  const height = 210;
  const pad = { top: 20, right: 2, bottom: 22, left: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxMs = Math.max(...weeks.flatMap((w) => kids.map((k) => w.perKid[k.id])), 0);
  const step = niceStep(maxMs / L.HOUR);
  const topHours = Math.max(step, Math.ceil(maxMs / L.HOUR / step) * step);
  const y = (ms) => plotH + pad.top - (ms / (topHours * L.HOUR)) * plotH;
  const band = plotW / weeks.length;
  const gap = 2;
  const barW = Math.min(24, Math.max(3, (band * 0.76 - gap * (kids.length - 1)) / kids.length));
  const groupW = barW * kids.length + gap * (kids.length - 1);

  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': 'Bar chart of play time per kid per week' });
  const wrap = h('div', { class: 'chart-wrap' }, root);
  const tip = h('div', { class: 'chart-tip', role: 'status', hidden: true });
  wrap.append(tip);

  for (let hr = 0; hr <= topHours; hr += step) {
    root.append(
      svg('line', { x1: pad.left, x2: width - pad.right, y1: y(hr * L.HOUR), y2: y(hr * L.HOUR), class: hr ? 'grid' : 'axis' }),
      svg('text', { x: pad.left - 6, y: y(hr * L.HOUR) + 4, class: 'tick', 'text-anchor': 'end' }, `${hr}h`),
    );
  }

  let peakDone = false;
  const showTip = (bar, text, cx, top) => {
    tip.textContent = text;
    tip.hidden = false;
    const scale = wrap.clientWidth / width;
    const left = Math.max(70, Math.min(wrap.clientWidth - 70, cx * scale));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, top * scale - 38)}px`;
    root.querySelectorAll('.bar.active').forEach((b) => b.classList.remove('active'));
    bar.classList.add('active');
  };
  const hideTip = () => {
    tip.hidden = true;
    root.querySelectorAll('.bar.active').forEach((b) => b.classList.remove('active'));
  };

  weeks.forEach((week, wi) => {
    const groupX = pad.left + band * wi + (band - groupW) / 2;
    if (weeks.length <= 8 && (band > 34 || wi % 2 === 0)) {
      root.append(svg('text', { x: pad.left + band * wi + band / 2, y: height - 6, class: 'tick', 'text-anchor': 'middle' }, L.fmtDate(week.start, now).slice(0, 5)));
    }
    kids.forEach((kid, ki) => {
      const ms = week.perKid[kid.id];
      const x = groupX + ki * (barW + gap);
      const text = `${kid.name}, week of ${L.fmtDate(week.start, now)}: ${L.fmtDuration(ms)}`;
      const top = Math.min(y(ms), plotH + pad.top - 2);
      const bar = ms > 0 ? svg('path', { d: roundedTop(x, top, barW, plotH + pad.top - top), class: `bar ${seriesClass(kid)}` }) : svg('g');
      root.append(bar);
      if (ms > 0 && ms === maxMs && !peakDone) {
        peakDone = true;
        root.append(svg('text', { x: x + barW / 2, y: top - 5, class: 'peak', 'text-anchor': 'middle' }, shortDuration(ms)));
      }
      // Touch target taller and wider than the bar itself.
      const hit = svg('rect', {
        x: x - gap / 2, y: pad.top, width: barW + gap, height: plotH, class: 'hit', tabindex: ms > 0 ? 0 : -1, 'aria-label': text,
      });
      const show = () => showTip(bar, text, x + barW / 2, top);
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hideTip);
      hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
      root.append(hit);
    });
  });
  return wrap;
}

function roundedTop(x, top, w, barH) {
  const r = Math.min(4, w / 2, barH);
  const bottom = top + barH;
  return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${bottom} Z`;
}
