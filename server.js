const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── Moderator token (set HOST_TOKEN env var on Render for a permanent URL) ──
const HOST_TOKEN = process.env.HOST_TOKEN || 'homeplay-host';

// ── Static files ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Moderator route ──────────────────────────────────────────────
app.get('/moderator/:token', (req, res) => {
  if (req.params.token !== HOST_TOKEN) {
    // Invalid token — serve plain audience view
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  // Valid token — inject moderator flag into the page
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const injected = html.replace(
    '</head>',
    `<script>window.__IS_MODERATOR = true; window.__HOST_TOKEN = "${HOST_TOKEN}";</script>\n</head>`
  );
  res.send(injected);
});

// ── In-memory state ──────────────────────────────────────────────

const PRESENTERS = ['Robert', 'Kyle', 'Tim', 'Chris', 'Matt', 'James', 'Adam'];

let state = {
  presenters: PRESENTERS,
  questions: [],          // { id, text, askedBy, forPresenter, upvotes: Set, timestamp }
  currentPresenter: null,
  presenterStartedAt: null,   // epoch ms when current presenter started
  presentationDuration: 360,  // seconds per presenter (6 min)
  completedPresenters: [],    // presenters who have finished
  quickfireActive: false,
  quickfireIndex: -1,
  quickfireQuestionStartedAt: null,  // epoch ms when current QF question started
  quickfireQuestionDuration: 90,     // seconds per question (1 min 30s)
  users: new Map(),       // socketId -> { name, isModerator }
  hostSocketId: null,
};

let nextQuestionId = 1;
let presenterTimeout = null;  // auto-advance timer

function getPublicState() {
  return {
    presenters: state.presenters,
    currentPresenter: state.currentPresenter,
    presenterStartedAt: state.presenterStartedAt,
    presentationDuration: state.presentationDuration,
    completedPresenters: state.completedPresenters,
    quickfireActive: state.quickfireActive,
    quickfireIndex: state.quickfireIndex,
    quickfireQuestionStartedAt: state.quickfireQuestionStartedAt,
    quickfireQuestionDuration: state.quickfireQuestionDuration,
    questions: state.questions.map(q => ({
      id: q.id,
      text: q.text,
      askedBy: q.askedBy,
      forPresenter: q.forPresenter,
      upvoteCount: q.upvotes.size,
      timestamp: q.timestamp,
    })),
    userCount: state.users.size,
  };
}

function getSortedQuestions() {
  return [...state.questions].sort((a, b) => b.upvotes.size - a.upvotes.size || a.timestamp - b.timestamp);
}

function broadcastState() {
  const pub = getPublicState();
  // Send personalised upvote info per user
  for (const [socketId, user] of state.users) {
    const personalised = {
      ...pub,
      questions: pub.questions.map(q => {
        const orig = state.questions.find(oq => oq.id === q.id);
        return { ...q, upvotedByMe: orig.upvotes.has(socketId) };
      }),
      isHost: socketId === state.hostSocketId,
      myName: user.name,
    };
    io.to(socketId).emit('state', personalised);
  }
}

// ── Auto-advance logic ───────────────────────────────────────────

function clearPresenterTimeout() {
  if (presenterTimeout) {
    clearTimeout(presenterTimeout);
    presenterTimeout = null;
  }
}

function startPresenterTimeout() {
  clearPresenterTimeout();
  if (!state.currentPresenter || state.quickfireActive) return;

  presenterTimeout = setTimeout(() => {
    advanceToNextPresenter();
  }, state.presentationDuration * 1000);
}

function advanceToNextPresenter() {
  if (!state.currentPresenter) return;

  const currentIdx = state.presenters.indexOf(state.currentPresenter);

  // Mark current as completed
  if (!state.completedPresenters.includes(state.currentPresenter)) {
    state.completedPresenters.push(state.currentPresenter);
  }

  // Find next presenter
  const nextIdx = currentIdx + 1;
  if (nextIdx < state.presenters.length) {
    state.currentPresenter = state.presenters[nextIdx];
    state.presenterStartedAt = Date.now();
    startPresenterTimeout();
  } else {
    // All presenters done
    state.currentPresenter = null;
    state.presenterStartedAt = null;
  }

  broadcastState();
}

// ── Socket.io events ─────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('join', ({ name, hostToken }) => {
    if (!name || !name.trim()) return;
    const isModerator = hostToken === HOST_TOKEN;
    state.users.set(socket.id, { name: name.trim(), isModerator });

    // Moderator always becomes host
    if (isModerator) {
      state.hostSocketId = socket.id;
    }

    broadcastState();
  });

  socket.on('submit-question', ({ text, forPresenter }) => {
    const user = state.users.get(socket.id);
    if (!user || !text || !text.trim() || !forPresenter) return;
    state.questions.push({
      id: nextQuestionId++,
      text: text.trim(),
      askedBy: user.name,
      forPresenter,
      upvotes: new Set(),
      timestamp: Date.now(),
    });
    broadcastState();
  });

  socket.on('upvote', ({ questionId }) => {
    const q = state.questions.find(q => q.id === questionId);
    if (!q) return;
    // Toggle upvote
    if (q.upvotes.has(socket.id)) {
      q.upvotes.delete(socket.id);
    } else {
      q.upvotes.add(socket.id);
    }
    broadcastState();
  });

  // ── Host-only controls ──

  socket.on('set-presenter', ({ presenter }) => {
    if (socket.id !== state.hostSocketId) return;
    // Mark previous presenter as completed
    if (state.currentPresenter && presenter !== state.currentPresenter && !state.completedPresenters.includes(state.currentPresenter)) {
      state.completedPresenters.push(state.currentPresenter);
    }
    state.currentPresenter = presenter || null;
    state.presenterStartedAt = presenter ? Date.now() : null;
    startPresenterTimeout();
    broadcastState();
  });

  socket.on('start-quickfire', () => {
    if (socket.id !== state.hostSocketId) return;
    clearPresenterTimeout();
    // Mark current presenter as done if there is one
    if (state.currentPresenter && !state.completedPresenters.includes(state.currentPresenter)) {
      state.completedPresenters.push(state.currentPresenter);
    }
    state.quickfireActive = true;
    state.currentPresenter = null;
    state.presenterStartedAt = null;
    // Sort questions by votes and set index to first
    state.questions = getSortedQuestions();
    state.quickfireIndex = state.questions.length > 0 ? 0 : -1;
    state.quickfireQuestionStartedAt = state.quickfireIndex >= 0 ? Date.now() : null;
    broadcastState();
  });

  socket.on('next-question', () => {
    if (socket.id !== state.hostSocketId) return;
    if (state.quickfireIndex < state.questions.length - 1) {
      state.quickfireIndex++;
      state.quickfireQuestionStartedAt = Date.now();
      broadcastState();
    }
  });

  socket.on('prev-question', () => {
    if (socket.id !== state.hostSocketId) return;
    if (state.quickfireIndex > 0) {
      state.quickfireIndex--;
      state.quickfireQuestionStartedAt = Date.now();
      broadcastState();
    }
  });

  socket.on('end-quickfire', () => {
    if (socket.id !== state.hostSocketId) return;
    state.quickfireActive = false;
    state.quickfireIndex = -1;
    state.quickfireQuestionStartedAt = null;
    broadcastState();
  });

  socket.on('delete-question', ({ questionId }) => {
    if (socket.id !== state.hostSocketId) return;
    state.questions = state.questions.filter(q => q.id !== questionId);
    broadcastState();
  });

  socket.on('clear-questions', () => {
    if (socket.id !== state.hostSocketId) return;
    state.questions = [];
    nextQuestionId = 1;
    broadcastState();
  });

  socket.on('reset-presenters', () => {
    if (socket.id !== state.hostSocketId) return;
    clearPresenterTimeout();
    state.currentPresenter = null;
    state.presenterStartedAt = null;
    state.completedPresenters = [];
    broadcastState();
  });

  socket.on('reset-meeting', () => {
    if (socket.id !== state.hostSocketId) return;
    clearPresenterTimeout();
    state.questions = [];
    state.currentPresenter = null;
    state.presenterStartedAt = null;
    state.completedPresenters = [];
    state.quickfireActive = false;
    state.quickfireIndex = -1;
    nextQuestionId = 1;
    broadcastState();
  });

  socket.on('transfer-host', ({ socketId }) => {
    if (socket.id !== state.hostSocketId) return;
    if (state.users.has(socketId)) {
      state.hostSocketId = socketId;
      broadcastState();
    }
  });

  socket.on('disconnect', () => {
    const user = state.users.get(socket.id);
    state.users.delete(socket.id);

    if (socket.id === state.hostSocketId) {
      // Try to find another moderator connection
      let newHost = null;
      for (const [sid, u] of state.users) {
        if (u.isModerator) { newHost = sid; break; }
      }
      state.hostSocketId = newHost; // null if no moderator connected
    }

    broadcastState();
    console.log(`Disconnected: ${socket.id}`);
  });
});

// ── Start server ─────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`AI Show & Tell Q&A running on http://localhost:${PORT}`);
  console.log(`\n  Moderator URL: http://localhost:${PORT}/moderator/${HOST_TOKEN}\n`);
  console.log(`  Share the base URL with participants: http://localhost:${PORT}/`);
  console.log(`  Keep the moderator URL private — it gives you host controls.\n`);
});
