/* ── AI Show & Tell - Client ──────────────────────────────────── */

const socket = io();

// ── DOM refs ─────────────────────────────────────────────────────
const joinScreen = document.getElementById('join-screen');
const appScreen = document.getElementById('app-screen');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const userBadge = document.getElementById('user-badge');
const userCount = document.getElementById('user-count');
const currentPresenterBadge = document.getElementById('current-presenter-badge');

const hostBar = document.getElementById('host-bar');
const presenterSelect = document.getElementById('presenter-select');
const btnQuickfire = document.getElementById('btn-quickfire');
const btnPrevQ = document.getElementById('btn-prev-q');
const btnNextQ = document.getElementById('btn-next-q');
const btnEndQf = document.getElementById('btn-end-qf');

const questionForm = document.getElementById('question-form');
const forPresenter = document.getElementById('for-presenter');
const questionInput = document.getElementById('question-input');
const submitBtn = document.getElementById('submit-btn');

const filterTabs = document.getElementById('filter-tabs');
const questionsList = document.getElementById('questions-list');
const emptyState = document.getElementById('empty-state');

const schedulePanel = document.getElementById('schedule-panel');
const runningOrder = document.getElementById('running-order');
const timerDisplay = document.getElementById('timer-display');

const quickfireBanner = document.getElementById('quickfire-banner');
const quickfireCurrent = document.getElementById('quickfire-current');
const qfTimer = document.getElementById('qf-timer');
const qfNumber = document.getElementById('qf-number');
const qfLabel = document.getElementById('qf-label');
const qfQuestion = document.getElementById('qf-question');
const qfVotes = document.getElementById('qf-votes');

// ── Moderator detection ──────────────────────────────────────────
const isModerator = !!window.__IS_MODERATOR;
const hostToken = window.__HOST_TOKEN || null;

// ── State ────────────────────────────────────────────────────────
let currentState = null;
let activeFilter = 'all';
let myName = '';
let timerInterval = null;
let qfTimerInterval = null;

// ── Join ─────────────────────────────────────────────────────────
const savedName = localStorage.getItem('showandtell-name');
if (savedName) nameInput.value = savedName;

function doJoin() {
  const name = nameInput.value.trim();
  if (!name) return;
  myName = name;
  localStorage.setItem('showandtell-name', name);
  const joinData = { name };
  if (isModerator && hostToken) joinData.hostToken = hostToken;
  socket.emit('join', joinData);
  joinScreen.style.display = 'none';
  appScreen.classList.add('active');
}

joinBtn.addEventListener('click', doJoin);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

// ── Submit question ──────────────────────────────────────────────
function doSubmit() {
  const text = questionInput.value.trim();
  const presenter = forPresenter.value;
  if (!text || !presenter) return;
  socket.emit('submit-question', { text, forPresenter: presenter });
  questionInput.value = '';
  questionInput.focus();
}

submitBtn.addEventListener('click', doSubmit);
questionInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });

// ── Host controls ────────────────────────────────────────────────
presenterSelect.addEventListener('change', () => {
  socket.emit('set-presenter', { presenter: presenterSelect.value || null });
});

const btnReset = document.getElementById('btn-reset');
const btnResetPresenters = document.getElementById('btn-reset-presenters');
const btnClearQuestions = document.getElementById('btn-clear-questions');

btnQuickfire.addEventListener('click', () => socket.emit('start-quickfire'));
btnNextQ.addEventListener('click', () => socket.emit('next-question'));
btnPrevQ.addEventListener('click', () => socket.emit('prev-question'));
btnEndQf.addEventListener('click', () => socket.emit('end-quickfire'));
btnReset.addEventListener('click', () => {
  if (confirm('Reset everything? This clears all questions, votes, and presenter progress.')) {
    socket.emit('reset-meeting');
  }
});
btnResetPresenters.addEventListener('click', () => {
  if (confirm('Reset presenters back to the beginning? Questions will be kept.')) {
    socket.emit('reset-presenters');
  }
});
btnClearQuestions.addEventListener('click', () => {
  if (confirm('Delete all questions and votes?')) {
    socket.emit('clear-questions');
  }
});

// ── State rendering ──────────────────────────────────────────────
socket.on('state', (state) => {
  currentState = state;
  render();
});

function render() {
  const s = currentState;
  if (!s) return;

  // User info
  userBadge.textContent = s.myName;
  userCount.textContent = s.userCount + ' online';

  // Current presenter (hide entirely during quickfire)
  if (s.quickfireActive) {
    currentPresenterBadge.style.display = 'none';
  } else {
    currentPresenterBadge.style.display = '';
    if (s.currentPresenter) {
      currentPresenterBadge.textContent = 'Presenting: ' + s.currentPresenter;
    } else {
      currentPresenterBadge.textContent = 'No presenter yet';
    }
  }

  // Host bar
  if (s.isHost) {
    hostBar.classList.add('active');
    // Populate presenter select (only once or when list changes)
    if (presenterSelect.options.length !== s.presenters.length + 1) {
      presenterSelect.innerHTML = '<option value="">Select presenter...</option>';
      s.presenters.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        if (p === s.currentPresenter) opt.selected = true;
        presenterSelect.appendChild(opt);
      });
    }

    // Toggle quickfire buttons
    if (s.quickfireActive) {
      btnQuickfire.style.display = 'none';
      btnPrevQ.style.display = '';
      btnNextQ.style.display = '';
      btnEndQf.style.display = '';
    } else {
      btnQuickfire.style.display = '';
      btnPrevQ.style.display = 'none';
      btnNextQ.style.display = 'none';
      btnEndQf.style.display = 'none';
    }
  } else {
    hostBar.classList.remove('active');
  }

  // Populate "for presenter" dropdown (once)
  if (forPresenter.options.length !== s.presenters.length + 1) {
    forPresenter.innerHTML = '<option value="">Question for...</option>';
    s.presenters.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      forPresenter.appendChild(opt);
    });
  }

  // Quickfire mode (questions remain open for submission)
  if (s.quickfireActive) {
    quickfireBanner.classList.add('active');
  } else {
    quickfireBanner.classList.remove('active');
  }

  // Quickfire current question
  if (s.quickfireActive && s.quickfireIndex >= 0 && s.questions[s.quickfireIndex]) {
    const q = s.questions[s.quickfireIndex];
    quickfireCurrent.classList.add('active');
    qfNumber.textContent = 'Question ' + (s.quickfireIndex + 1) + ' of ' + s.questions.length;
    qfLabel.innerHTML = '<span class="qf-asker">' + escHtml(q.askedBy) + '</span> asks <span class="qf-target">' + escHtml(q.forPresenter) + '</span>';
    qfQuestion.textContent = q.text;
    qfVotes.textContent = q.upvoteCount + ' vote' + (q.upvoteCount !== 1 ? 's' : '');
    startQfTimer(s);
  } else {
    quickfireCurrent.classList.remove('active');
    stopQfTimer();
  }

  // Schedule panel (hide during quickfire)
  if (s.quickfireActive) {
    schedulePanel.classList.add('hidden');
  } else {
    schedulePanel.classList.remove('hidden');
    renderRunningOrder(s);
    startTimer(s);
  }

  // Build filter tabs
  renderFilterTabs(s);

  // Render questions
  renderQuestions(s);
}

function renderFilterTabs(s) {
  const presentersWithQs = [...new Set(s.questions.map(q => q.forPresenter))];
  filterTabs.innerHTML = '';

  const allTab = makeTab('All', 'all');
  filterTabs.appendChild(allTab);

  s.presenters.forEach(p => {
    const count = s.questions.filter(q => q.forPresenter === p).length;
    if (count > 0) {
      filterTabs.appendChild(makeTab(p + ' (' + count + ')', p));
    }
  });
}

function makeTab(label, value) {
  const btn = document.createElement('button');
  btn.className = 'filter-tab' + (activeFilter === value ? ' active' : '');
  btn.textContent = label;
  btn.addEventListener('click', () => {
    activeFilter = value;
    render();
  });
  return btn;
}

function renderQuestions(s) {
  let qs = s.questions;

  // Filter
  if (activeFilter !== 'all') {
    qs = qs.filter(q => q.forPresenter === activeFilter);
  }

  // Sort by votes descending, then by time
  qs = [...qs].sort((a, b) => b.upvoteCount - a.upvoteCount || a.timestamp - b.timestamp);

  if (qs.length === 0) {
    questionsList.innerHTML = '';
    emptyState.style.display = '';
    questionsList.appendChild(emptyState);
    return;
  }

  emptyState.style.display = 'none';
  questionsList.innerHTML = '';

  qs.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'question-card';
    if (s.quickfireActive && s.quickfireIndex >= 0 && s.questions[s.quickfireIndex] && s.questions[s.quickfireIndex].id === q.id) {
      card.classList.add('highlighted');
    }

    const rank = document.createElement('div');
    rank.className = 'question-rank';
    rank.textContent = '#' + (idx + 1);

    const voteCol = document.createElement('div');
    voteCol.className = 'vote-col';

    const isOwnQuestion = q.askedBy === s.myName;
    const upBtn = document.createElement('button');
    upBtn.className = 'btn-upvote' + (q.upvotedByMe ? ' voted' : '') + (isOwnQuestion ? ' own' : '');
    upBtn.innerHTML = '&#9650;';
    if (isOwnQuestion) {
      upBtn.disabled = true;
      upBtn.title = 'You can\u2019t upvote your own question';
    } else {
      upBtn.addEventListener('click', () => socket.emit('upvote', { questionId: q.id }));
    }

    const voteCount = document.createElement('div');
    voteCount.className = 'vote-count';
    voteCount.textContent = q.upvoteCount;

    voteCol.appendChild(upBtn);
    voteCol.appendChild(voteCount);

    const content = document.createElement('div');
    content.className = 'question-content';

    const meta = document.createElement('div');
    meta.className = 'question-meta';
    meta.innerHTML = '<span class="asker">' + escHtml(q.askedBy) + '</span> asks <span class="target">' + escHtml(q.forPresenter) + '</span>';

    const text = document.createElement('div');
    text.className = 'question-text';
    text.textContent = q.text;

    content.appendChild(meta);
    content.appendChild(text);

    card.appendChild(rank);
    card.appendChild(voteCol);
    card.appendChild(content);

    // Host gets a delete button on each question
    if (s.isHost) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete-q';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete this question';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('delete-question', { questionId: q.id });
      });
      card.appendChild(delBtn);
    }

    questionsList.appendChild(card);
  });
}

function renderRunningOrder(s) {
  const currentIdx = s.presenters.indexOf(s.currentPresenter);
  runningOrder.innerHTML = '';

  s.presenters.forEach((p, idx) => {
    const item = document.createElement('div');
    item.className = 'ro-item';

    const isDone = s.completedPresenters.includes(p);
    const isCurrent = p === s.currentPresenter;
    const isNext = !isCurrent && !isDone && currentIdx >= 0 && idx === currentIdx + 1;
    const isNextWaiting = !s.currentPresenter && !isDone && idx === (s.completedPresenters.length);

    if (isDone) item.classList.add('done');
    else if (isCurrent) item.classList.add('current');
    else if (isNext || isNextWaiting) item.classList.add('next');

    // Host can click any pill to start that presenter
    if (s.isHost) {
      item.classList.add('clickable');
      item.addEventListener('click', () => {
        socket.emit('set-presenter', { presenter: p });
      });
    }

    const dot = document.createElement('span');
    dot.className = 'ro-dot';
    item.appendChild(dot);

    if (isDone) {
      const check = document.createElement('span');
      check.className = 'ro-check';
      check.textContent = '\u2713';
      item.appendChild(check);
    }

    const name = document.createElement('span');
    name.textContent = p;
    item.appendChild(name);

    if (isCurrent) {
      const label = document.createElement('span');
      label.className = 'ro-label';
      label.textContent = 'NOW';
      item.appendChild(label);
    } else if (isNext || isNextWaiting) {
      const label = document.createElement('span');
      label.className = 'ro-label';
      label.textContent = 'NEXT';
      item.appendChild(label);
    }

    runningOrder.appendChild(item);
  });
}

function startTimer(s) {
  // Clear any existing timer
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (!s.currentPresenter || !s.presenterStartedAt) {
    timerDisplay.textContent = 'Waiting to start...';
    timerDisplay.className = 'timer-display inactive';
    return;
  }

  function tick() {
    const elapsed = Date.now() - s.presenterStartedAt;
    const totalMs = s.presentationDuration * 1000;
    const remaining = Math.max(0, totalMs - elapsed);
    const secs = Math.ceil(remaining / 1000);
    const m = Math.floor(secs / 60);
    const ss = String(secs % 60).padStart(2, '0');

    timerDisplay.textContent = m + ':' + ss;
    timerDisplay.className = 'timer-display';

    if (secs <= 60 && secs > 0) {
      timerDisplay.classList.add('warning');
    }
    if (secs === 0) {
      timerDisplay.textContent = '0:00';
      timerDisplay.classList.add('warning');
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  tick(); // run immediately
  timerInterval = setInterval(tick, 1000);
}

function stopQfTimer() {
  if (qfTimerInterval) {
    clearInterval(qfTimerInterval);
    qfTimerInterval = null;
  }
}

function startQfTimer(s) {
  stopQfTimer();
  if (!s.quickfireQuestionStartedAt) return;

  function qfTick() {
    const elapsed = Date.now() - s.quickfireQuestionStartedAt;
    const totalMs = s.quickfireQuestionDuration * 1000;
    const remaining = totalMs - elapsed;

    qfTimer.className = 'qf-timer';

    if (remaining > 0) {
      // Counting down
      const secs = Math.ceil(remaining / 1000);
      const m = Math.floor(secs / 60);
      const ss = String(secs % 60).padStart(2, '0');
      qfTimer.textContent = m + ':' + ss;

      // Warning when under 30 seconds
      if (secs <= 30) {
        qfTimer.classList.add('qf-warning');
      }
    } else {
      // Over time — count up
      const overMs = Math.abs(remaining);
      const overSecs = Math.floor(overMs / 1000);
      const m = Math.floor(overSecs / 60);
      const ss = String(overSecs % 60).padStart(2, '0');
      qfTimer.textContent = '+' + m + ':' + ss + ' over';
      qfTimer.classList.add('qf-over');
    }
  }

  qfTick();
  qfTimerInterval = setInterval(qfTick, 1000);
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Reconnect handling ───────────────────────────────────────────
socket.on('connect', () => {
  if (myName) {
    const joinData = { name: myName };
    if (isModerator && hostToken) joinData.hostToken = hostToken;
    socket.emit('join', joinData);
  }
});
