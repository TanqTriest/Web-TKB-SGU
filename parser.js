/* =========================================================
 * parser.js - Tách dữ liệu thời khóa biểu từ file PDF / Excel / CSV
 * Không phụ thuộc DOM nên có thể test bằng Node.
 * ======================================================= */
(function (root) {
  'use strict';

  /* ---------- Tiện ích ---------- */
  const strip = (s) =>
    String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const key = (s) => strip(s).replace(/[^a-z0-9]/g, '');
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Nhãn tiêu đề cột (đã bỏ dấu, bỏ khoảng trắng) -> trường dữ liệu
  const LABELS = {
    code: ['mamh', 'mahocphan', 'mamonhoc', 'mamon', 'mahp'],
    name: ['tenmonhoc', 'tenhocphan', 'tenmon', 'tenhp'],
    lecturer: ['hovaten', 'giangvien', 'tengiangvien', 'hotengiangvien', 'hoten'],
    group: ['nh', 'nhom'],
    practice: ['toth', 'tothuchanh'],
    students: ['sosv', 'siso', 'sosinhvien'],
    day: ['thu'],
    start: ['tietbd', 'tietbatdau'],
    count: ['sotiet'],
    room: ['phong', 'maphong'],
  };
  function fieldOf(label) {
    const k = key(label);
    for (const f in LABELS) if (LABELS[f].includes(k)) return f;
    return null;
  }

  function parseDay(s) {
    const t = strip(s).trim();
    if (/^(cn|chu nhat)$/.test(t)) return 8;
    const m = /^(?:thu\s*)?([2-8])$/.exec(t);
    return m ? parseInt(m[1], 10) : NaN;
  }
  const parseSmallInt = (s) => (/^\d{1,2}$/.test(clean(s)) ? parseInt(clean(s), 10) : NaN);
  const firstNumber = (s) => {
    const m = /\d+/.exec(String(s ?? ''));
    return m ? parseInt(m[0], 10) : 0;
  };

  /* ---------- Gộp kết quả thành danh sách lớp học phần ---------- */
  function finalize(rawGroups, nameByCode, warnings) {
    const map = new Map();
    for (const g of rawGroups) {
      if (!g.code) {
        warnings.push('Bỏ qua một nhóm lịch học không có Mã MH.');
        continue;
      }
      const id = [g.code, g.group, g.practice].join('|');
      let c = map.get(id);
      if (!c) {
        c = { id, code: g.code, name: g.name || nameByCode[g.code] || '', group: g.group, practice: g.practice, students: g.students, schedules: [] };
        map.set(id, c);
      }
      if (!c.name && g.name) c.name = g.name;
      for (const s of g.rows) {
        const dup = c.schedules.some((x) => x.day === s.day && x.start === s.start && x.count === s.count && x.room === s.room);
        if (!dup) c.schedules.push({ day: s.day, start: s.start, count: s.count, room: s.room || '', lecturer: s.lecturer || '' });
      }
    }
    const out = [...map.values()];
    out.forEach((c) => {
      c.schedules.sort((a, b) => a.day - b.day || a.start - b.start);
      c.lecturer = [...new Set(c.schedules.map((s) => s.lecturer).filter(Boolean))].join(', ');
      if (!c.name) c.name = c.code;
    });
    return out;
  }

  /* =========================================================
   * 1) EXCEL / CSV: nhận mảng 2 chiều
   * ======================================================= */
  function parseRows(matrix) {
    const warnings = [];
    let headerIdx = -1;
    let cols = {};
    for (let i = 0; i < Math.min(matrix.length, 80); i++) {
      const m = {};
      (matrix[i] || []).forEach((cell, j) => {
        const f = fieldOf(cell);
        if (f && !(f in m)) m[f] = j;
      });
      if (Object.keys(m).length >= 5 && 'day' in m && 'start' in m && 'code' in m) {
        headerIdx = i;
        cols = m;
        break;
      }
    }
    if (headerIdx < 0) {
      return { classes: [], warnings: ['Không tìm thấy dòng tiêu đề (Mã MH, Thứ, Tiết BĐ, Số tiết, Phòng...).'] };
    }

    const groups = [];
    const nameByCode = {};
    let cur = null;
    for (let i = headerIdx + 1; i < matrix.length; i++) {
      const r = matrix[i] || [];
      const get = (f) => (f in cols ? clean(r[cols[f]]) : '');
      const day = parseDay(get('day'));
      const start = parseSmallInt(get('start'));
      const count = parseSmallInt(get('count'));
      if (!(day >= 2) || !(start >= 1) || !(count >= 1)) continue;

      const code = get('code');
      const group = get('group');
      if (code || group || !cur) {
        cur = {
          code: code || (cur ? cur.code : ''),
          group: group || (code ? '' : cur ? cur.group : ''),
          name: get('name') || (code ? '' : cur ? cur.name : ''),
          practice: get('practice') || (code ? '' : cur ? cur.practice : ''),
          students: firstNumber(get('students')) || (code ? 0 : cur ? cur.students : 0),
          rows: [],
        };
        groups.push(cur);
      }
      if (cur.code && cur.name) nameByCode[cur.code] = cur.name;
      cur.rows.push({ day, start, count, room: get('room'), lecturer: get('lecturer') });
    }
    return { classes: finalize(groups, nameByCode, warnings), warnings };
  }

  /* =========================================================
   * 2) PDF: nhận danh sách trang với vị trí từng chuỗi chữ
   *    page = { items: [{str, x, y, w, h}], vlines: [x...] }
   *    y tính từ trên xuống (viewport), vlines là các đường kẻ dọc của bảng
   * ======================================================= */
  const dist = (a, b, c, d) => Math.max(a, c) - Math.min(b, d); // khoảng cách giữa 2 đoạn [a,b] và [c,d]

  function joinItems(items, h) {
    let out = '';
    items.forEach((it, i) => {
      if (i === 0) { out = it.str; return; }
      const prev = items[i - 1];
      const gap = it.x - (prev.x + prev.w);
      out += (gap < 0.12 * h ? '' : ' ') + it.str;
    });
    return out;
  }

  // Gom các chữ trong vùng tiêu đề thành các nhãn cột
  function clusterHeader(band, h) {
    const n = band.length;
    const p = Array.from({ length: n }, (_, i) => i);
    const find = (i) => (p[i] === i ? i : (p[i] = find(p[i])));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = band[i];
        const b = band[j];
        const gap = dist(a.x, a.x + a.w, b.x, b.x + b.w);
        if (gap < 0.45 * h && Math.abs(a.y - b.y) < 2.2 * h) p[find(i)] = find(j);
      }
    }
    const map = new Map();
    band.forEach((it, i) => {
      const r = find(i);
      if (!map.has(r)) map.set(r, []);
      map.get(r).push(it);
    });
    return [...map.values()].map((its) => {
      its.sort((a, b) => (Math.abs(a.y - b.y) < 0.5 * h ? a.x - b.x : a.y - b.y));
      const x1 = Math.min(...its.map((i) => i.x));
      const x2 = Math.max(...its.map((i) => i.x + i.w));
      const text = its.map((i) => i.str).join(' ');
      return { text, x1, x2, cx: (x1 + x2) / 2, field: fieldOf(text) };
    });
  }

  function findHeader(items) {
    for (const t of items.filter((i) => key(i.str) === 'thu')) {
      const h = t.h || 10;
      const band = items.filter((i) => Math.abs(i.y - t.y) <= 1.7 * h);
      const clusters = clusterHeader(band, h);
      const fields = clusters.map((c) => c.field);
      if (['day', 'start', 'count', 'room'].every((f) => fields.includes(f))) {
        return { clusters, bottom: t.y + 1.7 * h };
      }
    }
    return null;
  }

  // Xác định khoảng x của từng cột dựa trên đường kẻ dọc (nếu có), nếu không thì dựa vào tiêu đề
  function makeColumns(clusters, vlines) {
    const cols = clusters.map((c) => ({ ...c })).sort((a, b) => a.cx - b.cx);
    const xs = [...vlines].sort((a, b) => a - b);
    const usable = xs.length >= cols.length;
    cols.forEach((c, i) => {
      if (usable) {
        const left = xs.filter((x) => x < c.cx);
        const right = xs.filter((x) => x > c.cx);
        c.L = left.length ? left[left.length - 1] : -Infinity;
        c.R = right.length ? right[0] : Infinity;
      } else {
        const prev = cols[i - 1];
        const next = cols[i + 1];
        c.L = prev ? (prev.x2 + c.x1) / 2 : -Infinity;
        c.R = next ? (c.x2 + next.x1) / 2 : Infinity;
      }
    });
    return cols;
  }

  const TEXT_FIELDS = ['lecturer', 'name'];
  const isAlpha = (str) => !/[\d.*_]/.test(str) && /\p{L}{2,}/u.test(str) && !/^cn$/i.test(str);

  function colOf(it, cols) {
    // Chọn cột có phần giao với chữ lớn nhất (chính xác hơn so với chỉ xét tâm)
    let best = null;
    let bestOv = 0;
    for (const c of cols) {
      const ov = Math.min(c.R, it.x + it.w) - Math.max(c.L, it.x);
      if (ov > bestOv + 0.01 || (best && Math.abs(ov - bestOv) <= 0.01 && c.R - c.L < best.R - best.L)) {
        best = c;
        bestOv = ov;
      }
    }
    // Chữ thuần chữ cái (không số) chỉ có thể thuộc cột chữ (Họ và tên / Tên môn học):
    // chọn cột chữ gần nhất để tên ngắn không bị rơi sang cột lân cận.
    if (isAlpha(it.str) && (!best || !TEXT_FIELDS.includes(best.field))) {
      const cx0 = it.x + it.w / 2;
      let d0 = Infinity;
      let pick = null;
      for (const c of cols) {
        if (!TEXT_FIELDS.includes(c.field)) continue;
        const dd = Math.abs(cx0 - c.cx);
        if (dd < d0) { d0 = dd; pick = c; }
      }
      if (pick) best = pick;
    }
    if (!best) {
      const cx = it.x + it.w / 2;
      let d = Infinity;
      for (const c of cols) {
        const dd = Math.abs(cx - c.cx);
        if (dd < d) { d = dd; best = c; }
      }
    }
    return best;
  }

  function buildLines(items, cols, tol, h) {
    const sorted = [...items].sort((a, b) => a.y - b.y);
    const lines = [];
    for (const it of sorted) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(it.y - last.y) <= tol) {
        last.items.push(it);
        last.y = (last.y * (last.items.length - 1) + it.y) / last.items.length;
      } else lines.push({ y: it.y, items: [it] });
    }
    lines.forEach((l) => {
      l.items.sort((a, b) => a.x - b.x);
      const buckets = new Map();
      l.items.forEach((it) => {
        const c = colOf(it, cols);
        if (!c || !c.field) return;
        if (!buckets.has(c.field)) buckets.set(c.field, []);
        buckets.get(c.field).push(it);
      });
      l.cells = {};
      buckets.forEach((its, f) => { l.cells[f] = clean(joinItems(its, h)); });
      // Sửa lỗi chữ ở rìa cột bị gán nhầm: "85 Phan Nguyệt Minh 20790" -> Số SV 85, GV "Phan Nguyệt Minh"
      if (l.cells.lecturer) {
        let lec = l.cells.lecturer;
        const lead = /^(\d{1,4})\s+(.+)$/.exec(lec);
        if (lead) { if (!l.cells.students) l.cells.students = lead[1]; lec = lead[2]; }
        lec = lec.replace(/\s+\d{4,}$/, '');
        l.cells.lecturer = lec;
      }
      l.text = clean(joinItems(l.items, h));
    });
    return lines;
  }

  // Chia các dòng lịch học thành nhóm theo vị trí "ô gộp" (mã MH / nhóm nằm giữa các dòng của nhóm)
  function partition(rows, anchors) {
    const N = rows.length;
    const K = anchors.length;
    if (!K || !N) return [];

    // Cách 1: ô gộp canh giữa theo chiều dọc
    const centered = [];
    let i = 0;
    let costC = 0;
    for (let k = 0; k < K && i < N; k++) {
      let n;
      if (k === K - 1) n = N - i;
      else {
        const maxN = Math.max(1, N - i - (K - k - 1));
        let bestDiff = Infinity;
        n = 1;
        let sum = 0;
        for (let t = 1; t <= maxN; t++) {
          sum += rows[i + t - 1].y;
          const diff = Math.abs(sum / t - anchors[k].y);
          if (diff < bestDiff) { bestDiff = diff; n = t; }
        }
      }
      const seg = rows.slice(i, i + n);
      costC += Math.abs(seg.reduce((s, r) => s + r.y, 0) / seg.length - anchors[k].y);
      centered.push({ anchor: anchors[k], rows: seg });
      i += n;
    }

    // Cách 2: ô gộp canh trên (nhóm bắt đầu tại dòng gần mỏ neo nhất)
    const starts = anchors.map((a) => {
      let bi = 0;
      let bd = Infinity;
      rows.forEach((r, idx) => { const d = Math.abs(r.y - a.y); if (d < bd) { bd = d; bi = idx; } });
      return bi;
    });
    let topOk = starts.every((s, k) => k === 0 || s > starts[k - 1]);
    let top = [];
    let costT = Infinity;
    if (topOk) {
      costT = 0;
      starts.forEach((s, k) => {
        const e = k + 1 < K ? starts[k + 1] : N;
        top.push({ anchor: anchors[k], rows: rows.slice(s, e) });
        costT += Math.abs(rows[s].y - anchors[k].y);
      });
      if (starts[0] > 0) top[0].rows = rows.slice(0, top[0].rows.length + starts[0]);
    }
    return costT < costC * 0.5 ? top : centered;
  }

  function parsePdfPages(pages) {
    const warnings = [];
    const nameByCode = {};
    const rows = [];
    const lines = [];
    const anchorLines = [];
    const sizes = [];
    let cols = null;

    pages.forEach((pg, pi) => {
      const items = (pg.items || [])
        .map((it) => ({ ...it, str: clean(it.str) }))
        .filter((it) => it.str);
      if (!items.length) return;

      const header = findHeader(items);
      let dataItems = items;
      if (header) {
        cols = makeColumns(header.clusters, pg.vlines || []);
        dataItems = items.filter((i) => i.y > header.bottom);
      } else if (!cols) {
        warnings.push(`Trang ${pi + 1}: không tìm thấy dòng tiêu đề của bảng.`);
        return;
      }
      const fs = median(dataItems.map((i) => i.h).filter(Boolean)) || 10;
      sizes.push(fs);

      buildLines(dataItems, cols, 0.5 * fs, fs).forEach((l) => {
        l.y += pi * 1e5;
        l.fs = fs;
        const m = /M[ôo]n\s*h[ọo]c\s*:\s*(.+?)\s*\(([^)]+)\)/i.exec(l.text);
        if (m) nameByCode[clean(m[2])] = clean(m[1]);

        const day = /^(\d|CN)$/i.test(l.cells.day || '') ? parseDay(l.cells.day) : NaN;
        const start = parseSmallInt(l.cells.start);
        const count = parseSmallInt(l.cells.count);
        lines.push(l);
        if (day >= 2 && start >= 1 && count >= 1) {
          rows.push({ y: l.y, day, start, count, room: l.cells.room || '', lecturer: l.cells.lecturer || '', line: l });
        }
        if ((l.cells.code && /^[A-Za-z0-9._-]{2,}$/.test(l.cells.code)) || (l.cells.group && /^[A-Za-z0-9]{1,4}$/.test(l.cells.group))) {
          anchorLines.push(l);
        }
      });
    });

    if (!rows.length) {
      warnings.push('Không đọc được dòng lịch học nào. File có thể là ảnh quét (không có chữ) hoặc khác mẫu.');
      return { classes: [], warnings };
    }

    const fs = median(sizes) || 10;

    // Gộp các mỏ neo gần nhau (mã MH và nhóm cùng một ô gộp)
    anchorLines.sort((a, b) => a.y - b.y);
    const anchors = [];
    anchorLines.forEach((l) => {
      const last = anchors[anchors.length - 1];
      if (last && Math.abs(l.y - last.y) < 0.7 * fs) {
        last.cells = { ...l.cells, ...last.cells };
      } else anchors.push({ y: l.y, cells: { ...l.cells } });
    });

    rows.sort((a, b) => a.y - b.y);
    const diffs = [];
    for (let i = 1; i < rows.length; i++) {
      const d = rows[i].y - rows[i - 1].y;
      if (d > 0 && d < 4 * fs) diffs.push(d);
    }
    const pitch = median(diffs) || 1.6 * fs;

    const parts = partition(rows, anchors);
    if (!parts.length) warnings.push('Không xác định được Mã MH / Nhóm cho các dòng lịch học.');

    const groups = parts.map(({ anchor, rows: gr }) => {
      const lo = gr[0].y - 0.55 * pitch;
      const hi = gr[gr.length - 1].y + 0.55 * pitch;
      const inSpan = lines.filter((l) => l.y >= lo && l.y <= hi);
      const uniq = (f) => {
        const out = [];
        inSpan.forEach((l) => { if (l.cells[f] && !out.includes(l.cells[f])) out.push(l.cells[f]); });
        return out;
      };
      const fallbackLecturer = uniq('lecturer')[0] || '';
      return {
        code: anchor.cells.code || '',
        group: anchor.cells.group || '',
        practice: uniq('practice')[0] || '',
        name: uniq('name').join(' '),
        students: firstNumber(uniq('students')[0]),
        rows: gr.map((r) => ({ day: r.day, start: r.start, count: r.count, room: r.room, lecturer: r.lecturer || fallbackLecturer })),
      };
    });

    return { classes: finalize(groups, nameByCode, warnings), warnings };
  }

  const api = { parseRows, parsePdfPages, fieldOf, key };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TKBParser = api;
})(typeof window !== 'undefined' ? window : this);
