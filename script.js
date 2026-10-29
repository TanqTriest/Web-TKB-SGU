(() => {
  'use strict';

  const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const KEYS = { classes: 'tkb2_classes', selected: 'tkb2_selected', theme: 'tkb2_theme', files: 'tkb2_files' };
  const DAY_NAMES = { 2: 'Thứ 2', 3: 'Thứ 3', 4: 'Thứ 4', 5: 'Thứ 5', 6: 'Thứ 6', 7: 'Thứ 7', 8: 'Chủ nhật' };

  /* ---------- Lưu trữ ---------- */
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Không thể lưu dữ liệu vào trình duyệt.', 'error'); }
    },
  };

  const state = {
    classes: store.get(KEYS.classes, []),
    selected: store.get(KEYS.selected, []),
    files: store.get(KEYS.files, []),
    theme: store.get(KEYS.theme, 'light'),
    open: new Set(),
    tab: 'register',
  };

  /* ---------- Tiện ích ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim();
  const dayName = (d) => DAY_NAMES[d] || `Thứ ${d}`;
  const range = (s) => (s.count > 1 ? `${s.start}-${s.start + s.count - 1}` : `${s.start}`);
  const fmt = (s) => `${dayName(s.day)} · tiết ${range(s)}${s.room ? ' · ' + s.room : ''}`;

  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('toastContainer').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function colorOf(code) {
    let h = 0;
    for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${(h * 47) % 360}, 52%, 36%)`;
  }

  const byId = (id) => state.classes.find((c) => c.id === id);
  const selectedClasses = () => state.selected.map(byId).filter(Boolean);
  const overlaps = (a, b) => a.day === b.day && a.start < b.start + b.count && b.start < a.start + a.count;
  function clash(c1, c2) {
    return c1.schedules.some((s1) => c2.schedules.some((s2) => overlaps(s1, s2)));
  }

  /* =========================================================
   * Đọc file
   * ======================================================= */
  async function getVLines(page, viewport, fs) {
    const lib = window.pdfjsLib;
    const OPS = lib.OPS;
    const U = lib.Util;
    const xs = [];
    const minLen = 1.2 * fs;
    const ops = await page.getOperatorList();
    let ctm = viewport.transform.slice();
    const stack = [];
    const apply = (x, y) => U.applyTransform([x, y], ctm);

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm.slice());
      else if (fn === OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === OPS.transform) ctm = U.transform(ctm, args);
      else if (fn === OPS.constructPath) {
        const pathOps = args[0];
        const coords = args[1];
        let ci = 0;
        let cur = null;
        for (const op of pathOps) {
          if (op === OPS.moveTo) { cur = apply(coords[ci], coords[ci + 1]); ci += 2; }
          else if (op === OPS.lineTo) {
            const nx = apply(coords[ci], coords[ci + 1]);
            ci += 2;
            if (cur && Math.abs(cur[0] - nx[0]) < 0.6 && Math.abs(cur[1] - nx[1]) > minLen) xs.push(nx[0]);
            cur = nx;
          } else if (op === OPS.rectangle) {
            const [x, y, w, h] = [coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3]];
            ci += 4;
            const p1 = apply(x, y);
            const p2 = apply(x + w, y + h);
            if (Math.abs(p1[1] - p2[1]) > minLen) xs.push(p1[0], p2[0]);
          } else if (op === OPS.curveTo) ci += 6;
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) ci += 4;
        }
      }
    }
    // Gộp các đường kẻ gần nhau
    xs.sort((a, b) => a - b);
    const merged = [];
    xs.forEach((x) => {
      const last = merged[merged.length - 1];
      if (last && x - last.sum / last.n < 2) { last.sum += x; last.n++; } else merged.push({ sum: x, n: 1 });
    });
    return merged.map((m) => m.sum / m.n);
  }

  async function extractPdf(buffer) {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('Không tải được thư viện đọc PDF. Hãy kiểm tra kết nối mạng.');
    lib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
    const pdf = await lib.getDocument({ data: buffer }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = [];
      tc.items.forEach((it) => {
        if (!it.str || !it.str.trim()) return;
        const [a, b, c, d, e, f] = it.transform;
        const pt = lib.Util.applyTransform([e, f], viewport.transform);
        items.push({ str: it.str, x: pt[0], y: pt[1], w: it.width * viewport.scale, h: Math.hypot(c, d) || it.height });
      });
      const sizes = items.map((i) => i.h).sort((x, y) => x - y);
      const fs = sizes.length ? sizes[sizes.length >> 1] : 10;
      let vlines = [];
      try { vlines = await getVLines(page, viewport, fs); } catch (e) { vlines = []; }
      pages.push({ items, vlines });
    }
    return pages;
  }

  async function readFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') {
      const pages = await extractPdf(await file.arrayBuffer());
      const result = window.TKBParser.parsePdfPages(pages);
      if (result.classes.length && pages.every((p) => p.vlines.length < 4)) {
        result.warnings.push('Không đọc được đường kẻ bảng trong PDF nên độ chính xác có thể thấp hơn (đặc biệt với tên ngắn).');
      }
      return result;
    }
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || ext === 'txt') {
      if (!window.XLSX) throw new Error('Không tải được thư viện đọc Excel. Hãy kiểm tra kết nối mạng.');
      let wb;
      if (ext === 'csv' || ext === 'txt') {
        wb = window.XLSX.read(new TextDecoder('utf-8').decode(await file.arrayBuffer()), { type: 'string' });
      } else {
        wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      }
      const all = { classes: [], warnings: [] };
      wb.SheetNames.forEach((name) => {
        const matrix = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false });
        const r = window.TKBParser.parseRows(matrix);
        all.classes.push(...r.classes);
        if (!r.classes.length && wb.SheetNames.length === 1) all.warnings.push(...r.warnings);
      });
      if (!all.classes.length && !all.warnings.length) all.warnings.push('Không tìm thấy bảng lịch học trong file.');
      return all;
    }
    throw new Error('Định dạng file chưa được hỗ trợ (chỉ nhận PDF, Excel, CSV).');
  }

  async function handleFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const status = $('importStatus');
    status.innerHTML = '';
    const notices = [];
    let added = 0;

    for (const file of files) {
      status.innerHTML = `<div class="notice"><span class="spinner"></span>Đang đọc ${esc(file.name)}...</div>`;
      try {
        const { classes, warnings } = await readFile(file);
        if (classes.length) {
          classes.forEach((c) => {
            const i = state.classes.findIndex((x) => x.id === c.id);
            if (i >= 0) state.classes[i] = c; else state.classes.push(c);
          });
          added += classes.length;
          if (!state.files.includes(file.name)) state.files.push(file.name);
          const sessions = classes.reduce((n, c) => n + c.schedules.length, 0);
          notices.push({ type: 'ok', title: `${file.name}: đọc được ${classes.length} lớp học phần, ${sessions} buổi học.`, list: warnings });
        } else {
          notices.push({ type: 'error', title: `${file.name}: không đọc được dữ liệu.`, list: warnings });
        }
      } catch (err) {
        console.error(err);
        notices.push({ type: 'error', title: `${file.name}: ${err.message || 'lỗi khi đọc file.'}`, list: [] });
      }
    }

    state.selected = state.selected.filter((id) => byId(id));
    store.set(KEYS.classes, state.classes);
    store.set(KEYS.selected, state.selected);
    store.set(KEYS.files, state.files);

    status.innerHTML = notices.map((n) => {
      const cls = n.type === 'error' ? 'error' : n.list.length ? 'warn' : '';
      return `<div class="notice ${cls}">${esc(n.title)}${n.list.length ? `<ul>${n.list.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>`;
    }).join('');
    if (added) toast(`Đã nhập ${added} lớp học phần.`, 'success');
    renderAll();
  }

  /* =========================================================
   * Hiển thị
   * ======================================================= */
  function filteredClasses() {
    const q = norm($('searchInput').value);
    if (!q) return state.classes;
    return state.classes.filter((c) =>
      [c.code, c.name, c.lecturer, c.group, ...c.schedules.map((s) => s.room)].some((f) => norm(f).includes(q)));
  }

  function renderSummary() {
    const n = state.classes.length;
    const subjects = new Set(state.classes.map((c) => c.code)).size;
    $('importSummary').textContent = n
      ? `Đang có ${subjects} môn, ${n} lớp học phần${state.files.length ? ' từ: ' + state.files.join(', ') : ''}.`
      : 'Chưa có dữ liệu. Hãy nhập file thời khóa biểu để bắt đầu.';
  }

  function renderCourseList() {
    const box = $('courseList');
    if (!state.classes.length) {
      box.innerHTML = '<div class="empty">Chưa có dữ liệu. Hãy nhập file thời khóa biểu ở phía trên.</div>';
      return;
    }
    const list = filteredClasses();
    if (!list.length) {
      box.innerHTML = '<div class="empty">Không có lớp học phần phù hợp.</div>';
      return;
    }
    const subjects = new Map();
    list.forEach((c) => {
      if (!subjects.has(c.code)) subjects.set(c.code, { code: c.code, name: c.name, lecturer: c.lecturer, classes: [] });
      subjects.get(c.code).classes.push(c);
    });
    const by = $('sortBy').value;
    const dir = $('sortOrder').value === 'desc' ? -1 : 1;
    const arr = [...subjects.values()].sort((a, b) =>
      dir * String(a[by] || '').localeCompare(String(b[by] || ''), 'vi', { numeric: true, sensitivity: 'base' }));
    arr.forEach((s) => s.classes.sort((a, b) => a.group.localeCompare(b.group, 'vi', { numeric: true })));

    const picked = selectedClasses();
    const searching = !!$('searchInput').value.trim();
    box.innerHTML = arr.map((s) => {
      const pickedHere = s.classes.find((c) => state.selected.includes(c.id));
      const open = state.open.has(s.code) || (searching && arr.length <= 5);
      const rows = s.classes.map((c) => {
        const isSel = state.selected.includes(c.id);
        let reason = '';
        if (!isSel) {
          const sameSubject = picked.find((p) => p.code === c.code);
          const other = picked.find((p) => clash(p, c));
          if (sameSubject) reason = `Đã chọn nhóm ${sameSubject.group} của môn này`;
          else if (other) reason = `Trùng lịch với ${other.code} - ${other.name}`;
        }
        const btn = isSel
          ? `<button type="button" class="btn btn-danger btn-sm" data-remove="${esc(c.id)}">Bỏ chọn</button>`
          : `<button type="button" class="btn btn-primary btn-sm" data-add="${esc(c.id)}" ${reason ? 'disabled' : ''}>Chọn</button>`;
        return `
          <div class="class-row ${isSel ? 'is-selected' : ''}">
            <div>
              <div class="class-head">Nhóm ${esc(c.group || '—')}${c.practice ? ' · Tổ TH ' + esc(c.practice) : ''}</div>
              <div class="class-meta">${esc(c.lecturer || 'Chưa rõ giảng viên')}${c.students ? ' · ' + c.students + ' SV' : ''}</div>
              <div class="chips">${c.schedules.map((x) => `<span class="chip">${esc(fmt(x))}</span>`).join('')}</div>
              ${reason ? `<div class="reason">${esc(reason)}</div>` : ''}
            </div>
            ${btn}
          </div>`;
      }).join('');
      return `
        <details class="subject" data-code="${esc(s.code)}" ${open ? 'open' : ''}>
          <summary>
            <span class="subject-title">${esc(s.code)} - ${esc(s.name)}<small>${s.classes.length} nhóm</small></span>
            ${pickedHere ? '<span class="badge picked">Đã chọn</span>' : ''}
          </summary>
          ${rows}
        </details>`;
    }).join('');
  }

  function renderData() {
    const list = filteredClasses();
    const flat = [];
    list.forEach((c) => c.schedules.forEach((s) => flat.push({ c, s })));
    const by = $('sortBy').value;
    const dir = $('sortOrder').value === 'desc' ? -1 : 1;
    flat.sort((a, b) => dir * String(a.c[by] || '').localeCompare(String(b.c[by] || ''), 'vi', { numeric: true, sensitivity: 'base' })
      || a.c.group.localeCompare(b.c.group, 'vi', { numeric: true }) || a.s.day - b.s.day || a.s.start - b.s.start);
    const LIMIT = 600;
    $('dataBody').innerHTML = flat.slice(0, LIMIT).map(({ c, s }) => `
      <tr>
        <td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${esc(s.lecturer || c.lecturer)}</td>
        <td>${esc(c.group)}</td><td>${esc(c.practice)}</td><td>${c.students || ''}</td>
        <td>${s.day}</td><td>${s.start}</td><td>${s.count}</td><td>${esc(s.room)}</td>
      </tr>`).join('') || '<tr><td colspan="10">Chưa có dữ liệu.</td></tr>';
    $('dataNote').textContent = flat.length > LIMIT ? `Hiển thị ${LIMIT}/${flat.length} dòng. Dùng ô tìm kiếm để thu hẹp.` : `${flat.length} dòng.`;
  }

  function renderSelected() {
    const list = selectedClasses();
    const periods = list.reduce((n, c) => n + c.schedules.reduce((a, s) => a + s.count, 0), 0);
    $('stats').innerHTML = `<span class="stat">${list.length} lớp</span><span class="stat">${periods} tiết / tuần</span>`;
    $('selectedList').innerHTML = list.length
      ? list.map((c) => `
        <div class="selected-item">
          <div class="bar" style="background:${colorOf(c.code)}"></div>
          <div>
            <h4>${esc(c.code)} - ${esc(c.name)}</h4>
            <div class="class-meta">Nhóm ${esc(c.group)} · ${esc(c.lecturer || 'Chưa rõ giảng viên')}</div>
            <div class="chips">${c.schedules.map((x) => `<span class="chip">${esc(fmt(x))}</span>`).join('')}</div>
          </div>
          <button type="button" class="btn btn-danger btn-sm no-print" data-remove="${esc(c.id)}">Bỏ</button>
        </div>`).join('')
      : '<div class="empty">Bạn chưa chọn lớp nào.</div>';
    $('clearSelectedBtn').classList.toggle('hidden', !list.length);
  }

  function renderTimetable() {
    const list = selectedClasses();
    const entries = [];
    list.forEach((c) => c.schedules.forEach((s) => entries.push({ c, s })));
    const days = [2, 3, 4, 5, 6, 7];
    if (entries.some((e) => e.s.day === 8)) days.push(8);
    const maxP = Math.max(12, ...entries.map((e) => e.s.start + e.s.count - 1));
    const rendered = new Set();
    const skip = {};

    let html = `<thead><tr><th class="period">Tiết</th>${days.map((d) => `<th>${dayName(d)}</th>`).join('')}</tr></thead><tbody>`;
    for (let p = 1; p <= maxP; p++) {
      html += `<tr><th class="period">${p}</th>`;
      days.forEach((d) => {
        if (skip[d] > 0) { skip[d]--; return; }
        const idx = entries.findIndex((e, i) => !rendered.has(i) && e.s.day === d && p >= e.s.start && p < e.s.start + e.s.count);
        if (idx < 0) { html += '<td class="blank"></td>'; return; }
        rendered.add(idx);
        const { c, s } = entries[idx];
        const span = Math.min(s.start + s.count - p, maxP - p + 1);
        skip[d] = span - 1;
        html += `<td class="tt-cell" rowspan="${span}" style="background:${colorOf(c.code)};color:#fff">
          <strong>${esc(c.code)} - ${esc(c.name)}</strong>
          <small>Phòng ${esc(s.room || '—')} · Nhóm ${esc(c.group)}</small>
          <small>${esc(s.lecturer || c.lecturer)}</small></td>`;
      });
      html += '</tr>';
    }
    $('timetable').innerHTML = html + '</tbody>';
  }

  function renderAll() {
    renderSummary();
    renderCourseList();
    renderData();
    renderSelected();
    renderTimetable();
  }

  /* =========================================================
   * Sự kiện
   * ======================================================= */
  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    $('themeBtn').textContent = state.theme === 'dark' ? '☀️ Chế độ sáng' : '🌙 Chế độ tối';
  }

  function addClass(id) {
    const c = byId(id);
    if (!c) return;
    const picked = selectedClasses();
    if (picked.some((p) => p.code === c.code)) return toast('Bạn đã chọn một nhóm khác của môn này.', 'error');
    const other = picked.find((p) => clash(p, c));
    if (other) return toast(`Trùng lịch với ${other.code} - ${other.name}.`, 'error');
    state.selected.push(id);
    state.open.add(c.code);
    store.set(KEYS.selected, state.selected);
    toast(`Đã chọn ${c.code} nhóm ${c.group}.`, 'success');
    renderAll();
  }

  function removeClass(id) {
    state.selected = state.selected.filter((x) => x !== id);
    store.set(KEYS.selected, state.selected);
    renderAll();
  }

  function bind() {
    const dz = $('dropzone');
    const input = $('fileInput');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragging'); }));
    dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
    // Tránh trình duyệt mở file khi thả ra ngoài vùng
    ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));

    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      state.tab = t.dataset.tab;
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $('tabRegister').classList.toggle('hidden', state.tab !== 'register');
      $('tabData').classList.toggle('hidden', state.tab !== 'data');
    }));

    const refresh = () => { renderCourseList(); renderData(); };
    $('searchInput').addEventListener('input', refresh);
    $('sortBy').addEventListener('change', refresh);
    $('sortOrder').addEventListener('change', refresh);

    $('courseList').addEventListener('toggle', (e) => {
      const d = e.target;
      if (d.matches && d.matches('details.subject')) {
        if (d.open) state.open.add(d.dataset.code); else state.open.delete(d.dataset.code);
      }
    }, true);

    document.addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]');
      const rem = e.target.closest('[data-remove]');
      if (add) addClass(add.dataset.add);
      else if (rem) removeClass(rem.dataset.remove);
    });

    $('clearSelectedBtn').addEventListener('click', () => {
      state.selected = [];
      store.set(KEYS.selected, []);
      renderAll();
    });

    $('clearDataBtn').addEventListener('click', () => {
      if (!state.classes.length) return toast('Chưa có dữ liệu để xóa.', 'warn');
      if (!confirm('Xóa toàn bộ dữ liệu đã nhập và các lớp đã chọn?')) return;
      state.classes = [];
      state.selected = [];
      state.files = [];
      store.set(KEYS.classes, []);
      store.set(KEYS.selected, []);
      store.set(KEYS.files, []);
      $('importStatus').innerHTML = '';
      renderAll();
      toast('Đã xóa dữ liệu.');
    });

    $('themeBtn').addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      store.set(KEYS.theme, state.theme);
      applyTheme();
    });

    $('printBtn').addEventListener('click', () => {
      if (!state.selected.length) return toast('Hãy chọn ít nhất một lớp để in.', 'warn');
      window.print();
    });
    window.addEventListener('beforeprint', () => {
      $('printDate').textContent = 'Ngày in: ' + new Date().toLocaleDateString('vi-VN');
    });
  }

  applyTheme();
  bind();
  renderAll();
})();
