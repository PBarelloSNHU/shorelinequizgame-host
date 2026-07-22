// main.js — Shoreline Quiz Game Host

const state = {
  isLoading: true,
  loadError: null,
  session: null, // { status, rosterCount, answeredCount, currentQuestionIndex, scoreboardCount, questions, answers }
};

const rootEl = document.getElementById('app');

function render() {
  console.log('[host] render status:', state.session?.status ?? 'none', {
    isLoading: state.isLoading,
    answeredCount: state.session?.answeredCount,
  });

  // 1. Only show Loading... while we have no session data at all.
  if (state.isLoading) {
    rootEl.innerHTML = renderLoading();
    return;
  }

  if (state.loadError) {
    rootEl.innerHTML = renderError(state.loadError);
    return;
  }

  if (!state.session) {
    rootEl.innerHTML = renderEmptySession();
    return;
  }

  const { status } = state.session;

  switch (status) {
    case 'lobby':
      rootEl.innerHTML = renderLobby(state.session);
      break;
    case 'question':
      rootEl.innerHTML = renderQuestion(state.session);
      break;
    case 'reveal':
      // 2. Reveal is a valid, fully-loaded state even when answeredCount is 0.
      rootEl.innerHTML = renderReveal(state.session);
      break;
    case 'scoreboard':
      rootEl.innerHTML = renderScoreboard(state.session);
      break;
    default:
      rootEl.innerHTML = renderUnknownStatus(status);
  }
}

function renderLoading() {
  return `<div class="host-loading">Loading...</div>`;
}

function renderError(message) {
  return `<div class="host-error">${escapeHtml(message)}</div>`;
}

function renderEmptySession() {
  return `<div class="host-empty">No session found.</div>`;
}

function renderUnknownStatus(status) {
  return `<div class="host-error">Unknown session status: ${escapeHtml(String(status))}</div>`;
}

function renderHeader(session) {
  const totalQuestions = session.questions?.length ?? 0;
  const questionNumber = totalQuestions > 0 ? session.currentQuestionIndex + 1 : 0;

  return `
    <header class="host-header">
      <div>Status: ${escapeHtml(session.status)}</div>
      <div>Players: ${session.rosterCount}</div>
      <div>Answered: ${session.answeredCount}</div>
      <div>Question: ${questionNumber}/${totalQuestions}</div>
    </header>
  `;
}

function renderLobby(session) {
  return `
    ${renderHeader(session)}
    <section class="host-lobby">
      <h1>Lobby</h1>
      <p>${session.rosterCount} player(s) connected.</p>
    </section>
  `;
}

function getCurrentQuestion(session) {
  const questions = session.questions ?? [];
  return questions[session.currentQuestionIndex] ?? null;
}

function renderQuestion(session) {
  const question = getCurrentQuestion(session);

  const body = question
    ? `
      <h1>Question ${session.currentQuestionIndex + 1}</h1>
      <p>${escapeHtml(question.prompt)}</p>
      <p>Answers received: ${session.answeredCount} / ${session.rosterCount}</p>
    `
    : `
      <h1>Question</h1>
      <p>Question ${session.currentQuestionIndex + 1} is not available yet.</p>
    `;

  return `
    ${renderHeader(session)}
    <section class="host-question">${body}</section>
  `;
}

// 3. Reveal view: explicitly separates "no answers" from "loading".
function renderReveal(session) {
  const question = getCurrentQuestion(session);
  const answers = session.answers ?? [];
  const answeredCount = session.answeredCount ?? 0;

  if (!question) {
    return `
      ${renderHeader(session)}
      <section class="host-reveal">
        <h1>Reveal</h1>
        <p>Question data is unavailable.</p>
      </section>
    `;
  }

  const answersMarkup =
    answeredCount === 0
      ? `<p class="reveal-empty">No players answered this question.</p>`
      : `
        <p>${answeredCount} answer(s) submitted.</p>
        <ul class="reveal-answers">
          ${answers
            .map(
              (answer) =>
                `<li>${escapeHtml(String(answer.playerId))}: choice ${
                  answer.choiceIndex + 1
                }${answer.isCorrect ? ' ✓' : ''}</li>`
            )
            .join('')}
        </ul>
      `;

  const correctAnswerMarkup =
    typeof question.correctIndex === 'number'
      ? `<p>Correct answer: choice ${question.correctIndex + 1}</p>`
      : '';

  return `
    ${renderHeader(session)}
    <section class="host-reveal">
      <h1>Reveal</h1>
      <p>${escapeHtml(question.prompt)}</p>
      ${answersMarkup}
      ${correctAnswerMarkup}
    </section>
  `;
}

function renderScoreboard(session) {
  return `
    ${renderHeader(session)}
    <section class="host-scoreboard">
      <h1>Scoreboard</h1>
      <p>${session.scoreboardCount} player score entries available.</p>
    </section>
  `;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Session subscription wiring ---

function handleSessionUpdate(nextSession) {
  console.log('[host] resynced session state:', nextSession);

  // Data has arrived — loading is over, regardless of answeredCount.
  state.isLoading = false;
  state.loadError = null;
  state.session = nextSession;

  render();
}

function handleSessionError(error) {
  console.error('[host] session subscribe error:', error);

  state.isLoading = false;
  state.loadError = 'Unable to load session.';

  render();
}

function initHost(sessionId, subscribeToSession) {
  state.isLoading = true;
  state.loadError = null;
  state.session = null;
  render();

  const unsubscribe = subscribeToSession(
    sessionId,
    handleSessionUpdate,
    handleSessionError
  );

  window.addEventListener('beforeunload', () => {
    if (typeof unsubscribe === 'function') unsubscribe();
  });
}

// Example wiring — replace with your real transport (WebSocket, Firebase, etc.)
// initHost(sessionId, subscribeToSession);

export { initHost, render, state };
