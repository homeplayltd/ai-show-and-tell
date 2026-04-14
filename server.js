const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory state ──────────────────────────────────────────────

const PRESENTERS = ['Robert', 'Kyle', 'Tim', 'Chris', 'Matt Irvin', 'James', 'Adam'];

let state = {
  presenters: PRESENTERS,
  questions: [],          // { id, text, askedBy, forPresenter, upvotes: Set, timestamp }
  currentPresenter: null,
  quickfireActive: false,
  quickfireIndex: -1,
  users: new Map(),       // socketId -> { name }
  hostSocketId: null,
};

let nextQuestionId = 1;

function getPublicState() {
  return {
    presenters: state.presenters,
    currentPresenter: state.currentPresenter,
    quickfireActive: state.quickfireActive,
    quickfireIndex: state.quickfireIndex,
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

// ── Socket.io events ─────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('join', ({ name }) => {
    if (!name || !name.trim()) return;
    state.users.set(socket.id, { name: name.trim() });
    // First user becomes host
    if (!state.hostSocketId) {
      state.hostSocketId = socket.id;
    }
    broadcastState();
  });

  socket.on('submit-question', ({ text, forPresenter }) => {
    if (state.quickfireActive) return; // locked
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
    state.currentPresenter = presenter;
    broadcastState();
  });

  socket.on('start-quickfire', () => {
    if (socket.id !== state.hostSocketId) return;
    state.quickfireActive = true;
    // Sort questions by votes and set index to first
    state.questions = getSortedQuestions();
    state.quickfireIndex = state.questions.length > 0 ? 0 : -1;
    broadcastState();
  });

  socket.on('next-question', () => {
    if (socket.id !== state.hostSocketId) return;
    if (state.quickfireIndex < state.questions.length - 1) {
      state.quickfireIndex++;
      broadcastState();
    }
  });

  socket.on('prev-question', () => {
    if (socket.id !== state.hostSocketId) return;
    if (state.quickfireIndex > 0) {
      state.quickfireIndex--;
      broadcastState();
    }
  });

  socket.on('end-quickfire', () => {
    if (socket.id !== state.hostSocketId) return;
    state.quickfireActive = false;
    state.quickfireIndex = -1;
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
    state.users.delete(socket.id);
    if (socket.id === state.hostSocketId) {
      // Transfer host to next user
      const next = state.users.keys().next();
      state.hostSocketId = next.done ? null : next.value;
    }
    broadcastState();
    console.log(`Disconnected: ${socket.id}`);
  });
});

// ── Start server ─────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`AI Show & Tell Q&A running on http://localhost:${PORT}`);
});
