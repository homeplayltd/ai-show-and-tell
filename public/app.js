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

const quickfireBanner = document.getElementById('quickfire-banner');
const quickfireCurrent = document.getElementById('quickfire-current');
const qfNumber = document.getElementById('qf-number');
const qfLabel = document.getElementById('qf-label');
const qfQuestion = document.getElementById('qf-question');
const qfVotes = document.getElementById('qf-votes');

// ── State ────────────────────────────────────────────────────────
let currentState = null;
let activeFilter = 'all';
let myName = '';

// ── Join ─────────────────────────────────────────────────────────
const savedName = localStorage.getItem('showandtell-name');
if (savedName) nameInput.value = savedName;

function doJoin() {
  const name = nameInput.value.trim();
  if (!name) return;
  myName = name;
  localStorage.setItem('showandtell-name', name);
  socket.emit('join', { name });
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

btnQuickfire.addEventListener('click', () => socket.emit('start-quickfire'));
btnNextQ.addEventListener('click', () => socket.emit('next-question'));
btnPrevQ.addEventListener('click', () => socket.emit('prev-question'));
btnEndQf.addEventListener('click', () => socket.emit('end-quickfire'));

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

  // Current presenter
  if (s.currentPresenter) {
    currentPresenterBadge.textContent = 'Presenting: ' + s.currentPresenter;
  } else {
    currentPresenterBadge.textContent = 'No presenter yet';
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

  // Quickfire mode
  if (s.quickfireActive) {
    quickfireBanner.classList.add('active');
    questionForm.classList.add('locked');
  } else {
    quickfireBanner.classList.remove('active');
    questionForm.classList.remove('locked');
  }

  // Quickfire current question
  if (s.quickfireActive && s.quickfireIndex >= 0 && s.questions[s.quickfireIndex]) {
    const q = s.questions[s.quickfireIndex];
    quickfireCurrent.classList.add('active');
    qfNumber.textContent = 'Question ' + (s.quickfireIndex + 1) + ' of ' + s.questions.length;
    qfLabel.innerHTML = '<span class="qf-asker">' + escHtml(q.askedBy) + '</span> asks <span class="qf-target">' + escHtml(q.forPresenter) + '</span>';
    qfQuestion.textContent = q.text;
    qfVotes.textContent = q.upvoteCount + ' vote' + (q.upvoteCount !== 1 ? 's' : '');
  } else {
    quickfireCurrent.classList.remove('active');
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

    const upBtn = document.createElement('button');
    upBtn.className = 'btn-upvote' + (q.upvotedByMe ? ' voted' : '');
    upBtn.innerHTML = '&#9650;';
    upBtn.addEventListener('click', () => socket.emit('upvote', { questionId: q.id }));

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
    questionsList.appendChild(card);
  });
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Reconnect handling ───────────────────────────────────────────
socket.on('connect', () => {
  if (myName) {
    socket.emit('join', { name: myName });
  }
});
