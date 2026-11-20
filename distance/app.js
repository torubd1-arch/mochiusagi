/* ゴルフ クラブ距離表
   - HTML/CSS/Vanilla JS のみ。外部ライブラリ・サーバー不要。
   - データは localStorage に保存する。 */
(function () {
  'use strict';

  var STORAGE_KEY = 'golfClubDistances.v1';

  /* 初期クラブと初期データ（空欄は null） */
  var DEFAULT_CLUBS = [
    { name: 'DR', carry: null, total: null },
    { name: '5W', carry: null, total: 130 },
    { name: '5U', carry: null, total: 118 },
    { name: '6U', carry: null, total: null },
    { name: '6I', carry: null, total: null },
    { name: '7I', carry: null, total: null },
    { name: '8I', carry: null, total: null },
    { name: '9I', carry: null, total: 80 },
    { name: 'PW', carry: 80, total: 90 },
    { name: 'AW', carry: 63, total: 75 },
    { name: 'SW', carry: null, total: null }
  ];

  var clubs = [];

  /* ===== データ入出力 ===== */

  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function normalize(c) {
    c = c || {};
    return {
      name: typeof c.name === 'string' ? c.name : '',
      carry: toNum(c.carry),
      total: toNum(c.total)
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          clubs = parsed.map(normalize);
          return;
        }
      }
    } catch (e) { /* 壊れていれば初期値に戻す */ }
    clubs = DEFAULT_CLUBS.map(normalize);
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clubs));
    } catch (e) { /* 保存できなくても操作は継続 */ }
  }

  function fmt(v) {
    return (v === null || v === undefined) ? '—' : String(v); /* — */
  }

  /* ===== 距離表の描画 ===== */

  var tableBody = document.getElementById('table-body');

  function renderTable() {
    tableBody.innerHTML = '';
    clubs.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'row';

      var club = document.createElement('div');
      club.className = 'cell club';
      club.textContent = c.name || '—';

      var carry = document.createElement('div');
      carry.className = 'cell carry num';
      carry.textContent = fmt(c.carry);
      if (c.carry === null) carry.classList.add('empty');

      var total = document.createElement('div');
      total.className = 'cell total num';
      total.textContent = fmt(c.total);
      if (c.total === null) total.classList.add('empty');

      row.appendChild(club);
      row.appendChild(carry);
      row.appendChild(total);
      tableBody.appendChild(row);
    });
  }

  /* ===== 編集の描画 ===== */

  var editList = document.getElementById('edit-list');

  function renderEdit() {
    editList.innerHTML = '';
    clubs.forEach(function (c, i) {
      editList.appendChild(buildEditRow(c, i));
    });
  }

  function buildEditRow(c, i) {
    var card = document.createElement('div');
    card.className = 'edit-card';

    /* 1行目：クラブ名 / 並び替え / 削除 */
    var line1 = document.createElement('div');
    line1.className = 'edit-line';

    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'inp-name';
    nameInput.value = c.name;
    nameInput.placeholder = 'クラブ名';
    nameInput.setAttribute('aria-label', 'クラブ名');
    nameInput.autocapitalize = 'characters';
    nameInput.autocomplete = 'off';
    nameInput.addEventListener('input', function () {
      clubs[i].name = nameInput.value;
      save();
    });

    var up = makeBtn('↑', 'btn-move', '上へ移動', function () { move(i, -1); });
    var down = makeBtn('↓', 'btn-move', '下へ移動', function () { move(i, 1); });
    var del = makeBtn('削除', 'btn-del', null, function () { removeClub(i); });

    line1.appendChild(nameInput);
    line1.appendChild(up);
    line1.appendChild(down);
    line1.appendChild(del);

    /* 2行目：CARRY / TOTAL の数値入力 */
    var line2 = document.createElement('div');
    line2.className = 'edit-line';
    line2.appendChild(numField('carry', 'CARRY', c.carry, function (v) {
      clubs[i].carry = v; save();
    }));
    line2.appendChild(numField('total', 'TOTAL', c.total, function (v) {
      clubs[i].total = v; save();
    }));

    card.appendChild(line1);
    card.appendChild(line2);
    return card;
  }

  function makeBtn(label, cls, ariaLabel, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
    b.addEventListener('click', onClick);
    return b;
  }

  function numField(key, label, value, onChange) {
    var wrap = document.createElement('label');
    wrap.className = 'num-field ' + key;

    var span = document.createElement('span');
    span.className = 'num-label';
    span.textContent = label;

    var inp = document.createElement('input');
    inp.type = 'number';
    inp.inputMode = 'numeric';           /* iPhone で数字キーボードを出す */
    inp.setAttribute('pattern', '[0-9]*');
    inp.min = '0';
    inp.step = '1';
    inp.placeholder = '—';
    inp.value = (value === null ? '' : value);
    inp.setAttribute('aria-label', label);
    inp.addEventListener('input', function () {
      onChange(toNum(inp.value));
    });

    wrap.appendChild(span);
    wrap.appendChild(inp);
    return wrap;
  }

  /* ===== 編集操作 ===== */

  function move(i, dir) {
    var j = i + dir;
    if (j < 0 || j >= clubs.length) return;
    var tmp = clubs[i];
    clubs[i] = clubs[j];
    clubs[j] = tmp;
    save();
    renderEdit();
  }

  function removeClub(i) {
    var label = clubs[i].name || 'このクラブ';
    if (!window.confirm(label + ' を削除しますか？')) return;
    clubs.splice(i, 1);
    save();
    renderEdit();
  }

  function addClub() {
    clubs.push({ name: '', carry: null, total: null });
    save();
    renderEdit();
    var inputs = editList.querySelectorAll('.inp-name');
    if (inputs.length) {
      var last = inputs[inputs.length - 1];
      last.focus();
      last.scrollIntoView({ block: 'center' });
    }
  }

  /* ===== 画面切替 ===== */

  var viewTable = document.getElementById('view-table');
  var viewEdit = document.getElementById('view-edit');

  function showTable() {
    renderTable();
    viewEdit.classList.add('hidden');
    viewTable.classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function showEdit() {
    renderEdit();
    viewTable.classList.add('hidden');
    viewEdit.classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  document.getElementById('btn-edit').addEventListener('click', showEdit);
  document.getElementById('btn-done').addEventListener('click', showTable);
  document.getElementById('btn-add').addEventListener('click', addClub);

  /* ===== 起動 ===== */
  load();
  showTable();
})();
