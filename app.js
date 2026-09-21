(function () {
  'use strict';

  var STORAGE_KEY = 'checklist-diario:v1';
  var SYNC_CODE_KEY = 'checklist-diario:syncCode';
  var EMOJI_CHOICES = [
    '🏠', '🛒', '💊', '📞', '🧺', '🐶', '🐱', '💼', '🧹', '🚗', '💰', '🏋️',
    '📚', '🍽️', '🧴', '🪴', '👶', '🎂', '🎁', '✈️', '🏥', '🦷', '👓', '💇',
    '💅', '🧾', '📦', '🔧', '🔌', '🧑‍💻', '📅', '🐾', '🍎', '🧽', '🛠️', '🎓',
    '⚽', '🎮', '🎵', '🌱', '🧻', '📮', '🏦', '⛪', '🚲', '🧵', '🐦', '🧯'
  ];

  // Preencher com a URL do Worker depois de "wrangler deploy" (ex: https://checklist-diario-push.SEU-SUBDOMINIO.workers.dev)
  var PUSH_SERVER_URL = 'https://checklist-diario-push.kalcarlos.workers.dev';
  var VAPID_PUBLIC_KEY = 'BGxLxsYdfeBxWWcN37VXpQrfOF5ME3a23FxJSwsayVup0N0ub6OVpDFi8-U6RwvAKLOu1f_BfqsdAaBbIb2Zmsg';

  // Dicionário inicial pra sugerir lista com base no texto do item. Além
  // disso o app aprende sozinho com o que você realmente adiciona em cada
  // lista (ver "sugestão de lista" mais abaixo).
  var CATEGORY_SEED = {
    mercado: {
      name: 'Mercado', emoji: '🛒',
      hints: ['merc', 'compra', 'supermerc'],
      words: ['leite', 'pao', 'arroz', 'feijao', 'acucar', 'cafe', 'detergente', 'sabao',
        'fruta', 'verdura', 'legume', 'carne', 'frango', 'ovo', 'manteiga', 'queijo',
        'iogurte', 'agua', 'refrigerante', 'cerveja', 'macarrao', 'molho', 'tempero',
        'sal', 'oleo', 'biscoito', 'bolacha', 'salgadinho', 'chocolate', 'shampoo',
        'condicionador', 'esponja', 'fosforo', 'pilha', 'racao', 'papel']
    },
    farmacia: {
      name: 'Farmácia', emoji: '💊',
      hints: ['farm'],
      words: ['dipirona', 'paracetamol', 'ibuprofeno', 'remedio', 'vitamina', 'curativo',
        'alcool', 'soro', 'pomada', 'xarope', 'protetor', 'absorvente', 'termometro',
        'mascara', 'gaze', 'receita', 'antialergico', 'colirio', 'fralda', 'band']
    },
    casa: {
      name: 'Casa', emoji: '🏠',
      hints: ['casa', 'domestic', 'limpeza'],
      words: ['lavar', 'louca', 'roupa', 'passar', 'aspirar', 'varrer', 'limpar',
        'banheiro', 'cozinha', 'lixo', 'regar', 'planta', 'cachorro', 'gato', 'passear',
        'arrumar', 'cama', 'poeira', 'organizar', 'lencol', 'tapete', 'janela',
        'geladeira', 'fogao']
    },
    contato: {
      name: 'Ligar / Agendar', emoji: '📞',
      hints: ['ligar', 'agend', 'contat', 'telefon'],
      words: ['ligar', 'agendar', 'marcar', 'consulta', 'dentista', 'medico', 'mecanico',
        'cabeleireiro', 'banco', 'agencia', 'cobranca', 'reuniao', 'entrevista', 'email',
        'whatsapp', 'encanador', 'eletricista', 'plano', 'seguro']
    }
  };
  var STOPWORDS = ['de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'um', 'uma', 'uns', 'umas',
    'e', 'o', 'a', 'os', 'as', 'com', 'no', 'na', 'nos', 'nas', 'em', 'ao', 'aos', 'ou', 'que', 'se'];

  var state = null;
  var currentListId = null;

  // ---------- persistência ----------

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- sugestão de lista pelo texto do item ----------

  function normalizeAccents(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  // ---------- arrastar pra reordenar (funciona com mouse e toque) ----------

  function setupDragReorder(container, row, handle, arr, item, onDone) {
    row.__item = item;
    var dragging = false, startY = 0;

    function clearHighlights() {
      Array.prototype.forEach.call(container.children, function (r) {
        r.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    }

    function siblingsOf() {
      return Array.prototype.slice.call(container.children).filter(function (r) { return r !== row; });
    }

    function onMove(e) {
      if (!dragging) return;
      row.style.transform = 'translateY(' + (e.clientY - startY) + 'px)';
      clearHighlights();
      siblingsOf().forEach(function (r) {
        var rect = r.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          r.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom');
        }
      });
    }

    function computeDropIndex(clientY) {
      var siblings = siblingsOf();
      for (var i = 0; i < siblings.length; i++) {
        var rect = siblings[i].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return arr.indexOf(siblings[i].__item);
      }
      return arr.length - 1;
    }

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      row.classList.remove('dragging');
      row.style.transform = '';
      row.style.position = '';
      row.style.zIndex = '';
      clearHighlights();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);

      var dropIndex = computeDropIndex(e.clientY);
      var currentIndex = arr.indexOf(item);
      if (dropIndex !== currentIndex && dropIndex >= 0) {
        arr.splice(currentIndex, 1);
        if (dropIndex > currentIndex) dropIndex--;
        arr.splice(dropIndex, 0, item);
        onDone();
      }
    }

    handle.addEventListener('click', function (e) { e.stopPropagation(); });

    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      startY = e.clientY;
      row.classList.add('dragging');
      row.style.position = 'relative';
      row.style.zIndex = '5';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    });
  }

  function stem(word) {
    // simplificação bem básica: tira plural terminado em "s" pra casar
    // "plantas" com "planta", "frutas" com "fruta", etc.
    if (word.length > 4 && word.charAt(word.length - 1) === 's') return word.slice(0, -1);
    return word;
  }

  function tokenize(text) {
    var norm = normalizeAccents(text.toLowerCase());
    return norm.split(/[^a-z0-9]+/).filter(function (w) {
      return w.length >= 3 && STOPWORDS.indexOf(w) === -1;
    }).map(stem);
  }

  function learnWord(word, listId, weight) {
    if (!state.wordListStats[word]) state.wordListStats[word] = {};
    state.wordListStats[word][listId] = (state.wordListStats[word][listId] || 0) + (weight || 1);
  }

  function learnFromText(text, listId) {
    tokenize(text).forEach(function (w) { learnWord(w, listId, 1); });
  }

  function seedListHints(list) {
    var normName = normalizeAccents(list.name.toLowerCase());
    Object.keys(CATEGORY_SEED).forEach(function (cat) {
      var def = CATEGORY_SEED[cat];
      var matches = def.hints.some(function (h) { return normName.indexOf(h) !== -1; });
      if (!matches) return;
      def.words.forEach(function (w) { learnWord(w, list.id, 2); });
    });
  }

  function categoryMatchesListName(catKey, list) {
    var normName = normalizeAccents(list.name.toLowerCase());
    return CATEGORY_SEED[catKey].hints.some(function (h) { return normName.indexOf(h) !== -1; });
  }

  function hasListForCategory(catKey) {
    return state.lists.some(function (l) { return categoryMatchesListName(catKey, l); });
  }

  function bestNewCategorySuggestion(words) {
    var bestKey = null, bestCount = 0;
    Object.keys(CATEGORY_SEED).forEach(function (catKey) {
      if (hasListForCategory(catKey)) return; // já existe lista pra essa categoria
      var count = words.filter(function (w) { return CATEGORY_SEED[catKey].words.indexOf(w) !== -1; }).length;
      if (count > bestCount) { bestCount = count; bestKey = catKey; }
    });
    return bestKey ? { key: bestKey, def: CATEGORY_SEED[bestKey] } : null;
  }

  function bestSuggestion(text, excludeListId) {
    var words = tokenize(text);
    if (words.length === 0) return null;
    var scores = {};
    words.forEach(function (w) {
      var stats = state.wordListStats[w];
      if (!stats) return;
      Object.keys(stats).forEach(function (id) {
        scores[id] = (scores[id] || 0) + stats[id];
      });
    });
    var currentScore = scores[excludeListId] || 0;
    var bestId = null, bestScore = 0;
    Object.keys(scores).forEach(function (id) {
      if (id === excludeListId) return;
      if (scores[id] > bestScore) { bestScore = scores[id]; bestId = id; }
    });
    if (bestId && bestScore > currentScore && bestScore >= 2) return { listId: bestId, score: bestScore };
    return null;
  }

  function createList(name, emoji, type) {
    var list = {
      id: uid(), name: name, emoji: emoji, type: type,
      reminder: { enabled: false, time: '08:00' }, items: []
    };
    seedListHints(list);
    return list;
  }

  function seedData() {
    // createList() usa state.wordListStats pra semear as dicas, então o
    // state precisa existir (mesmo que vazio) antes de criar as listas.
    state = { lastResetDate: todayStr(), wordListStats: {}, lists: [] };
    var casa = createList('Casa', '🏠', 'rotina');
    casa.items = [
      { id: uid(), text: 'Lavar a louça', done: false },
      { id: uid(), text: 'Passear com o cachorro', done: false },
      { id: uid(), text: 'Regar as plantas', done: false }
    ];
    state.lists = [
      casa,
      createList('Mercado', '🛒', 'lista'),
      createList('Farmácia', '💊', 'lista'),
      createList('Ligar / Agendar', '📞', 'lista')
    ];
    return state;
  }

  function load() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state = seedData();
      save();
      return;
    }
    try {
      state = JSON.parse(raw);
    } catch (e) {
      state = seedData();
    }
    ensureReminderDefaults();
    ensureWordStatsDefaults();
    applyDailyReset();
  }

  function ensureReminderDefaults() {
    state.lists.forEach(function (list) {
      if (!list.reminder) list.reminder = { enabled: false, time: '08:00' };
    });
  }

  function ensureWordStatsDefaults() {
    if (!state.wordListStats) state.wordListStats = {};
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    scheduleCloudBackup();
  }

  function applyDailyReset() {
    var today = todayStr();
    if (state.lastResetDate === today) return;
    state.lists.forEach(function (list) {
      if (list.type === 'rotina') {
        list.items.forEach(function (item) { item.done = false; });
      }
    });
    state.lastResetDate = today;
    save();
  }

  // ---------- navegação ----------

  var screenHome = document.getElementById('screen-home');
  var screenDetail = document.getElementById('screen-detail');

  function showHome() {
    currentListId = null;
    screenDetail.classList.add('hidden');
    screenHome.classList.remove('hidden');
    renderHome();
  }

  function showDetail(listId) {
    currentListId = listId;
    screenHome.classList.add('hidden');
    screenDetail.classList.remove('hidden');
    var input = document.getElementById('add-item-input');
    input.value = '';
    autoGrow(input);
    hideAddSuggestion();
    renderDetail();
  }

  function getList(id) {
    return state.lists.find(function (l) { return l.id === id; });
  }

  // ---------- render: home ----------

  function renderHome() {
    var container = document.getElementById('lists-container');
    container.innerHTML = '';

    if (state.lists.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nenhuma lista ainda. Toque no + para criar sua primeira checklist.';
      container.appendChild(empty);
      return;
    }

    state.lists.forEach(function (list) {
      var total = list.items.length;
      var done = list.items.filter(function (i) { return i.done; }).length;
      var pct = total === 0 ? 0 : Math.round((done / total) * 100);

      var card = document.createElement('div');
      card.className = 'list-card';
      card.innerHTML =
        '<div class="emoji">' + list.emoji + '</div>' +
        '<div class="info">' +
          '<textarea class="name" rows="1"></textarea>' +
          '<div class="meta">' + (total === 0 ? 'Sem itens' : (done + ' de ' + total + ' feitos')) +
            (list.type === 'rotina' ? ' · diária' : '') + '</div>' +
          '<div class="progress-bar"><div style="width:' + pct + '%"></div></div>' +
        '</div>' +
        '<button class="drag-handle" aria-label="Arrastar para reordenar">☰</button>';

      var nameEl = card.querySelector('.name');
      nameEl.value = list.name;

      nameEl.addEventListener('click', function (e) { e.stopPropagation(); });
      nameEl.addEventListener('input', function () { autoGrow(nameEl); });
      nameEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); nameEl.blur(); }
      });
      nameEl.addEventListener('blur', function () {
        var val = nameEl.value.trim();
        if (!val) { nameEl.value = list.name; return; }
        if (val !== list.name) { list.name = val; save(); }
      });

      setupDragReorder(container, card, card.querySelector('.drag-handle'), state.lists, list, function () {
        save();
        renderHome();
      });

      card.addEventListener('click', function () { showDetail(list.id); });
      container.appendChild(card);
      autoGrow(nameEl);
    });
  }

  // ---------- render: detalhe ----------

  function renderDetail() {
    var list = getList(currentListId);
    if (!list) { showHome(); return; }

    document.getElementById('detail-title').textContent = list.emoji + ' ' + list.name;
    document.getElementById('detail-hint').textContent = list.type === 'rotina'
      ? 'Lista diária: os itens desmarcam sozinhos todo dia à meia-noite.'
      : 'Lista simples: marque os itens e use "Limpar concluídos" quando quiser.';

    var container = document.getElementById('items-container');
    container.innerHTML = '';

    if (list.items.length === 0) {
      var li = document.createElement('li');
      li.className = 'empty-state';
      li.textContent = 'Nenhum item ainda. Adicione abaixo.';
      container.appendChild(li);
      return;
    }

    list.items.forEach(function (item) {
      var row = document.createElement('li');
      row.className = 'item-row' + (item.done ? ' done' : '');
      row.innerHTML =
        '<div class="check">' + (item.done ? '✓' : '') + '</div>' +
        '<textarea class="text" rows="1"></textarea>' +
        '<button class="drag-handle" aria-label="Arrastar para reordenar">☰</button>' +
        '<button class="delete" aria-label="Excluir">🗑️</button>';

      var textEl = row.querySelector('.text');
      textEl.value = item.text;

      row.querySelector('.check').addEventListener('click', function () {
        item.done = !item.done;
        save();
        renderDetail();
      });

      textEl.addEventListener('input', function () { autoGrow(textEl); });
      textEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textEl.blur(); }
      });
      textEl.addEventListener('blur', function () {
        var val = textEl.value.trim();
        if (!val) { textEl.value = item.text; return; }
        if (val !== item.text) {
          item.text = val;
          learnFromText(val, list.id);
          save();
        }
      });

      setupDragReorder(container, row, row.querySelector('.drag-handle'), list.items, item, function () {
        save();
        renderDetail();
      });

      row.querySelector('.delete').addEventListener('click', function () {
        list.items = list.items.filter(function (i) { return i.id !== item.id; });
        save();
        renderDetail();
      });

      container.appendChild(row);
      autoGrow(textEl);
    });
  }

  // ---------- adicionar item (com sugestão de lista) ----------

  var addSuggestionTimer = null;

  function hideAddSuggestion() {
    var box = document.getElementById('add-suggestion');
    box.classList.add('hidden');
    box.innerHTML = '';
  }

  function updateAddSuggestion(text) {
    var box = document.getElementById('add-suggestion');
    var suggestion = bestSuggestion(text, currentListId);
    var list = suggestion && getList(suggestion.listId);

    if (list) {
      box.classList.remove('hidden');
      box.innerHTML =
        '💡 Combina mais com <strong>' + list.emoji + ' ' + escapeHtml(list.name) + '</strong> ' +
        '<button id="add-suggestion-btn" class="btn btn-secondary" style="flex:none;padding:6px 10px;">Adicionar lá</button>';

      document.getElementById('add-suggestion-btn').addEventListener('click', function () {
        var input = document.getElementById('add-item-input');
        var text2 = input.value.trim();
        if (!text2) return;
        list.items.push({ id: uid(), text: text2, done: false });
        learnFromText(text2, list.id);
        save();
        input.value = '';
        autoGrow(input);
        hideAddSuggestion();
        renderHome();
        alert('Adicionado em ' + list.emoji + ' ' + list.name + '.');
      });
      return;
    }

    var words = tokenize(text);
    var newCat = words.length ? bestNewCategorySuggestion(words) : null;
    if (!newCat) { hideAddSuggestion(); return; }

    box.classList.remove('hidden');
    box.innerHTML =
      '💡 Não achei uma lista pra isso. Criar <strong>' + newCat.def.emoji + ' ' + escapeHtml(newCat.def.name) + '</strong>? ' +
      '<button id="add-suggestion-btn" class="btn btn-secondary" style="flex:none;padding:6px 10px;">Criar lista</button>';

    document.getElementById('add-suggestion-btn').addEventListener('click', function () {
      var input = document.getElementById('add-item-input');
      var text2 = input.value.trim();
      if (!text2) return;
      var newList = createList(newCat.def.name, newCat.def.emoji, 'lista');
      newList.items.push({ id: uid(), text: text2, done: false });
      learnFromText(text2, newList.id);
      state.lists.push(newList);
      save();
      input.value = '';
      autoGrow(input);
      hideAddSuggestion();
      renderHome();
      alert('Lista ' + newCat.def.emoji + ' ' + newCat.def.name + ' criada com o item.');
    });
  }

  document.getElementById('add-item-input').addEventListener('input', function () {
    autoGrow(this);
    var val = this.value;
    clearTimeout(addSuggestionTimer);
    addSuggestionTimer = setTimeout(function () { updateAddSuggestion(val); }, 250);
  });

  document.getElementById('add-item-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('add-item-form').requestSubmit();
    }
  });

  document.getElementById('add-item-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('add-item-input');
    var text = input.value.trim();
    if (!text) return;
    var list = getList(currentListId);
    list.items.push({ id: uid(), text: text, done: false });
    learnFromText(text, list.id);
    input.value = '';
    autoGrow(input);
    hideAddSuggestion();
    save();
    renderDetail();
  });

  document.getElementById('btn-back').addEventListener('click', showHome);

  // ---------- modal helper ----------

  var backdrop = document.getElementById('modal-backdrop');
  var modal = document.getElementById('modal');

  function openModal(html) {
    modal.innerHTML = html;
    backdrop.classList.remove('hidden');
  }

  function closeModal() {
    backdrop.classList.add('hidden');
    modal.innerHTML = '';
  }

  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop) closeModal();
  });

  // ---------- nova lista ----------

  document.getElementById('btn-new-list').addEventListener('click', function () {
    var chosenEmoji = EMOJI_CHOICES[0];
    var chosenType = 'lista';

    openModal(
      '<h2>Nova lista</h2>' +
      '<label>Nome<input id="m-name" type="text" placeholder="Ex: Academia" maxlength="40"></label>' +
      '<label>Ícone<div id="m-emojis" class="emoji-row"></div></label>' +
      '<label>Tipo' +
        '<div class="type-row">' +
          '<div class="type-choice" data-type="lista">Lista simples<small>marca e depois você limpa</small></div>' +
          '<div class="type-choice" data-type="rotina">Rotina diária<small>desmarca sozinha à meia-noite</small></div>' +
        '</div>' +
      '</label>' +
      '<div class="modal-actions">' +
        '<button id="m-cancel" class="btn btn-secondary">Cancelar</button>' +
        '<button id="m-create" class="btn btn-primary">Criar</button>' +
      '</div>'
    );

    var emojiRow = document.getElementById('m-emojis');
    EMOJI_CHOICES.forEach(function (em) {
      var span = document.createElement('span');
      span.className = 'emoji-choice' + (em === chosenEmoji ? ' selected' : '');
      span.textContent = em;
      span.addEventListener('click', function () {
        chosenEmoji = em;
        emojiRow.querySelectorAll('.emoji-choice').forEach(function (el) { el.classList.remove('selected'); });
        span.classList.add('selected');
      });
      emojiRow.appendChild(span);
    });

    modal.querySelectorAll('.type-choice').forEach(function (el) {
      if (el.dataset.type === chosenType) el.classList.add('selected');
      el.addEventListener('click', function () {
        chosenType = el.dataset.type;
        modal.querySelectorAll('.type-choice').forEach(function (o) { o.classList.remove('selected'); });
        el.classList.add('selected');
      });
    });

    document.getElementById('m-cancel').addEventListener('click', closeModal);
    document.getElementById('m-create').addEventListener('click', function () {
      var name = document.getElementById('m-name').value.trim();
      if (!name) return;
      state.lists.push(createList(name, chosenEmoji, chosenType));
      save();
      closeModal();
      renderHome();
    });

    document.getElementById('m-name').focus();
  });

  // ---------- menu da lista (⋯) ----------

  document.getElementById('btn-list-menu').addEventListener('click', function () {
    var list = getList(currentListId);
    if (!list) return;

    openModal(
      '<h2>' + list.emoji + ' ' + escapeHtml(list.name) + '</h2>' +
      '<label class="settings-row"><span>Lembrete diário</span>' +
        '<input id="m-reminder-enabled" type="checkbox"' + (list.reminder.enabled ? ' checked' : '') + '></label>' +
      '<label class="settings-row"><span>Horário</span>' +
        '<input id="m-reminder-time" type="time" value="' + list.reminder.time + '"></label>' +
      '<p class="hint" style="margin:0;">Pra receber esse aviso mesmo com o app fechado, ative "Notificações" em Ajustes.</p>' +
      '<button id="m-rename" class="btn btn-secondary">Renomear</button>' +
      '<button id="m-clear" class="btn btn-secondary">Limpar concluídos</button>' +
      '<button id="m-delete" class="btn btn-danger">Excluir lista</button>' +
      '<button id="m-cancel" class="btn btn-secondary">Fechar</button>'
    );

    function saveReminder() {
      list.reminder.enabled = document.getElementById('m-reminder-enabled').checked;
      list.reminder.time = document.getElementById('m-reminder-time').value || '08:00';
      save();
      syncPushSubscription();
    }
    document.getElementById('m-reminder-enabled').addEventListener('change', saveReminder);
    document.getElementById('m-reminder-time').addEventListener('change', saveReminder);

    document.getElementById('m-cancel').addEventListener('click', closeModal);

    document.getElementById('m-rename').addEventListener('click', function () {
      var novo = prompt('Novo nome da lista:', list.name);
      if (novo && novo.trim()) {
        list.name = novo.trim();
        save();
        closeModal();
        renderDetail();
      }
    });

    document.getElementById('m-clear').addEventListener('click', function () {
      list.items = list.items.filter(function (i) { return !i.done; });
      save();
      closeModal();
      renderDetail();
    });

    document.getElementById('m-delete').addEventListener('click', function () {
      if (confirm('Excluir a lista "' + list.name + '" e todos os seus itens?')) {
        state.lists = state.lists.filter(function (l) { return l.id !== list.id; });
        Object.keys(state.wordListStats).forEach(function (word) {
          delete state.wordListStats[word][list.id];
        });
        save();
        closeModal();
        showHome();
      }
    });
  });

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // ---------- ajustes (exportar / importar) ----------

  document.getElementById('btn-settings').addEventListener('click', function () {
    openModal(
      '<h2>Ajustes</h2>' +
      '<div class="settings-row"><span>Notificações</span><button id="m-push-toggle" class="btn btn-secondary" style="flex:none;">…</button></div>' +
      '<p id="m-push-status" class="hint" style="margin:0;"></p>' +
      '<div id="m-cloud-box" style="display:flex;flex-direction:column;gap:8px;"></div>' +
      '<p class="hint" style="margin:0;">O backup na nuvem é gratuito e automático depois de criado, mas não é criptografado com senha — não guarde nada sensível nas listas.</p>' +
      '<div class="settings-row"><span>Exportar backup (.json)</span><button id="m-export" class="btn btn-secondary" style="flex:none;">Exportar</button></div>' +
      '<div class="settings-row"><span>Importar backup (.json)</span><button id="m-import" class="btn btn-secondary" style="flex:none;">Importar</button></div>' +
      '<input id="m-import-file" type="file" accept="application/json" class="hidden" style="display:none;">' +
      '<div class="settings-row"><span>Verificar atualização do app</span><button id="m-check-update" class="btn btn-secondary" style="flex:none;">Verificar</button></div>' +
      '<button id="m-cancel" class="btn btn-secondary">Fechar</button>'
    );

    refreshPushUI();
    refreshCloudUI();

    document.getElementById('m-check-update').addEventListener('click', function () {
      if (!swRegistration) { alert('Ainda carregando, tenta de novo em alguns segundos.'); return; }
      swRegistration.update().then(function () {
        alert('Verificado. Se tinha uma versão nova, o app recarrega sozinho em instantes.');
      }).catch(function () {
        alert('Não deu pra verificar agora. Tenta mais tarde.');
      });
    });
    document.getElementById('m-push-toggle').addEventListener('click', function () {
      togglePushNotifications();
    });

    document.getElementById('m-cancel').addEventListener('click', closeModal);

    document.getElementById('m-export').addEventListener('click', function () {
      exportData();
    });

    var fileInput = document.getElementById('m-import-file');
    document.getElementById('m-import').addEventListener('click', function () {
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(reader.result);
          if (!parsed.lists) throw new Error('formato inválido');
          if (confirm('Isso substitui todos os dados atuais pelos do arquivo. Continuar?')) {
            state = parsed;
            if (!state.lastResetDate) state.lastResetDate = todayStr();
            ensureReminderDefaults();
            ensureWordStatsDefaults();
            save();
            closeModal();
            showHome();
            syncPushSubscription();
          }
        } catch (e) {
          alert('Arquivo inválido.');
        }
      };
      reader.readAsText(file);
    });
  });

  function exportData() {
    var json = JSON.stringify(state, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var file = new File([blob], 'checklist-diario-backup.json', { type: 'application/json' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Backup do Checklist Diário' }).catch(function () {});
      return;
    }

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'checklist-diario-backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  // ---------- backup na nuvem (não perder os dados) ----------

  var cloudBackupTimer = null;

  function getSyncCode() {
    return localStorage.getItem(SYNC_CODE_KEY);
  }

  function setSyncCode(code) {
    localStorage.setItem(SYNC_CODE_KEY, code);
  }

  function generateSyncCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem letras/números parecidos (0/O, 1/I/L)
    var bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    var code = '';
    for (var i = 0; i < bytes.length; i++) code += chars[bytes[i] % chars.length];
    return code;
  }

  function scheduleCloudBackup() {
    if (!getSyncCode()) return; // só faz backup automático depois que o usuário criar um código
    clearTimeout(cloudBackupTimer);
    cloudBackupTimer = setTimeout(uploadCloudBackup, 2000);
  }

  function uploadCloudBackup() {
    var code = getSyncCode();
    if (!code) return Promise.resolve();
    return fetch(PUSH_SERVER_URL + '/data/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, data: state })
    }).catch(function () {});
  }

  function downloadCloudBackup(code) {
    return fetch(PUSH_SERVER_URL + '/data/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code })
    }).then(function (resp) {
      if (!resp.ok) throw new Error(resp.status === 404 ? 'codigo nao encontrado' : 'erro no servidor');
      return resp.json();
    }).then(function (record) {
      return record.data;
    });
  }

  function refreshCloudUI() {
    var box = document.getElementById('m-cloud-box');
    if (!box) return;
    var code = getSyncCode();
    if (code) {
      box.innerHTML =
        '<p class="hint" style="margin:0;">Seu código de sincronização (anote e use nos outros aparelhos):</p>' +
        '<input id="m-cloud-code" type="text" value="' + code + '" readonly ' +
          'style="font-size:20px;letter-spacing:2px;text-align:center;font-weight:700;">' +
        '<button id="m-cloud-backup-now" class="btn btn-secondary">Fazer backup agora</button>';
      document.getElementById('m-cloud-backup-now').addEventListener('click', function () {
        uploadCloudBackup().then(function () { alert('Backup enviado.'); });
      });
    } else {
      box.innerHTML =
        '<button id="m-cloud-create" class="btn btn-secondary">Criar backup na nuvem</button>' +
        '<button id="m-cloud-restore" class="btn btn-secondary">Restaurar de um código</button>';
      document.getElementById('m-cloud-create').addEventListener('click', function () {
        setSyncCode(generateSyncCode());
        uploadCloudBackup();
        refreshCloudUI();
      });
      document.getElementById('m-cloud-restore').addEventListener('click', function () {
        var code = prompt('Digite o código de sincronização do outro aparelho:');
        if (!code) return;
        code = code.trim().toUpperCase();
        downloadCloudBackup(code).then(function (data) {
          if (!confirm('Isso substitui todos os dados atuais pelos da nuvem. Continuar?')) return;
          state = data;
          ensureReminderDefaults();
          ensureWordStatsDefaults();
          if (!state.lastResetDate) state.lastResetDate = todayStr();
          applyDailyReset();
          save();
          setSyncCode(code);
          closeModal();
          showHome();
        }).catch(function (err) {
          alert('Não foi possível restaurar: ' + err.message);
        });
      });
    }
  }

  // ---------- notificações push (lembretes de verdade) ----------

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function buildRemindersPayload() {
    return state.lists
      .filter(function (l) { return l.reminder && l.reminder.enabled; })
      .map(function (l) {
        return { listId: l.id, listName: l.name, emoji: l.emoji, time: l.reminder.time, enabled: true };
      });
  }

  function syncPushSubscription() {
    if (!pushSupported()) return Promise.resolve();
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (!sub) return; // notificações ainda não foram ativadas neste aparelho
      return fetch(PUSH_SERVER_URL + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          reminders: buildRemindersPayload()
        })
      }).catch(function () {});
    }).catch(function () {});
  }

  function enablePushNotifications() {
    if (!isStandalone()) {
      alert('Antes de ativar, adicione este app à Tela de Início (Safari → Compartilhar → Adicionar à Tela de Início) e abra por lá.');
      return Promise.resolve();
    }
    return Notification.requestPermission().then(function (permission) {
      if (permission !== 'granted') {
        alert('Permissão de notificação negada. Não vai dar pra receber os lembretes.');
        return;
      }
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }).then(function () {
        return syncPushSubscription();
      });
    });
  }

  function disablePushNotifications() {
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (!sub) return;
      var endpoint = sub.endpoint;
      return sub.unsubscribe().then(function () {
        return fetch(PUSH_SERVER_URL + '/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: endpoint })
        }).catch(function () {});
      });
    });
  }

  function togglePushNotifications() {
    if (!pushSupported()) return;
    navigator.serviceWorker.ready.then(function (reg) {
      reg.pushManager.getSubscription().then(function (sub) {
        var action = sub ? disablePushNotifications() : enablePushNotifications();
        action.then(refreshPushUI);
      });
    });
  }

  function refreshPushUI() {
    var btn = document.getElementById('m-push-toggle');
    var status = document.getElementById('m-push-status');
    if (!btn || !status) return;

    if (!pushSupported()) {
      btn.textContent = 'Indisponível';
      btn.disabled = true;
      status.textContent = 'Este navegador não suporta notificações push.';
      return;
    }
    if (!isStandalone()) {
      btn.textContent = 'Ativar';
      status.textContent = 'Adicione o app à Tela de Início e abra por lá antes de ativar.';
      return;
    }
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (sub) {
        btn.textContent = 'Desativar';
        status.textContent = 'Notificações ativadas. Configure o horário em cada lista (⋯).';
      } else {
        btn.textContent = 'Ativar';
        status.textContent = 'Desativadas. Depois de ativar, configure o horário em cada lista (⋯).';
      }
    });
  }

  // ---------- reset diário ao voltar pro app ----------

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      applyDailyReset();
      if (currentListId) renderDetail(); else renderHome();
    }
  });

  // ---------- service worker (offline + autoatualização) ----------

  var swRegistration = null;

  if ('serviceWorker' in navigator) {
    var refreshingAfterUpdate = false;
    // Quando uma versão nova assume o controle da página, recarrega sozinho
    // (sem isso, era preciso fechar e reabrir o app duas vezes pra ver uma
    // atualização, já que ele guarda uma cópia offline de tudo).
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshingAfterUpdate) return;
      refreshingAfterUpdate = true;
      window.location.reload();
    });

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').then(function (reg) {
        swRegistration = reg;
      }).catch(function () {});
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && swRegistration) {
        swRegistration.update().catch(function () {});
      }
    });
  }

  // ---------- boot ----------

  load();
  showHome();
})();
