// main.js — Shoreline Quiz Game Host
import * as api from './api.js'
import { joinSessionChannel } from './realtimeChannel.js'

const state = {
  isLoading: true,
  loadError: null,
  session: null, // { status, rosterCount, answeredCount, currentQuestionIndex, scoreboardCount, question, answers, joinCode }
}

const rootEl = document.getElementById('app')
let channel = null
let resyncPromise = null
let pollTimer = null

// ---------- Render ----------

function render() {
  console.log('[host] render status:', state.session?.status ?? 'none', {
    isLoading: state.isLoading,
    answeredCount: state.session?.answeredCount,
  })

  if (state.isLoading) {
    rootEl.innerHTML = renderLoading()
    return
  }
  if (state.loadError) {
    rootEl.innerHTML = renderError(state.loadError)
    wireRetry()
    return
  }
  if (!state.session) {
    rootEl.innerHTML = renderSetupScreen()
    wireSetup()
    return
  }

  const { status } = state.session
  switch (status) {
    case 'lobby':
      rootEl.innerHTML = renderLobby(state.session)
      wireControl('#start-question-btn', api.startQuestion)
      wireControl('#end-session-btn', api.endSession)
      break
    case 'question':
      rootEl.innerHTML = renderQuestion(state.session)
      wireControl('#reveal-btn', api.revealQuestion)
      wireControl('#end-session-btn', api.endSession)
      break
    case 'reveal':
      rootEl.innerHTML = renderReveal(state.session)
      wireControl('#advance-btn', api.advanceQuestion)
      wireControl('#end-session-btn', api.endSession)
      break
    case 'scoreboard':
    case 'ended':
      rootEl.innerHTML = renderScoreboard(state.session)
      break
    default:
      rootEl.innerHTML = renderUnknownStatus(status)
  }
}

function renderLoading() {
  return `<div class="host-loading">Loading…</div>`
}

function renderError(message) {
  return `
    <div class="host-error">
      <p>${escapeHtml(message)}</p>
      <button id="retry-btn">Retry</button>
    </div>
  `
}

function renderSetupScreen() {
  return `
    <div class="host-setup">
      <h1>Start a New Quiz</h1>
      <label>Level
        <select id="setup-level">
          <option value="200">200</option>
          <option value="210">210</option>
          <option value="220">220</option>
          <option value="230">230</option>
          <option value="240">240</option>
        </select>
      </label>
      <label>Question count
        <input id="setup-count" type="number" value="10" min="1" max="100" />
      </label>
      <label>Timer (seconds)
        <input id="setup-timer" type="number" value="30" min="5" max="120" />
      </label>
      <button id="create-session-btn">Create Session</button>
    </div>
  `
}

function renderUnknownStatus(status) {
  return `<div class="host-error">Unknown session status: ${escapeHtml(String(status))}</div>`
}

function renderHeader(session) {
  const totalQuestions = session.totalQuestions ?? 0
  const questionNumber = totalQuestions > 0 ? (session.currentQuestionIndex ?? 0) + 1 : 0
  return `
    <header class="host-header">
      <div>Join code: <strong>${escapeHtml(session.joinCode ?? '—')}</strong></div>
      <div>Status: ${escapeHtml(session.status)}</div>
      <div>Players: ${session.rosterCount}</div>
      <div>Answered: ${session.answeredCount}</div>
      <div>Question: ${questionNumber}/${totalQuestions}</div>
    </header>
  `
}

function renderLobby(session) {
  return `
    ${renderHeader(session)}
    <section class="host-lobby">
      <h1>Lobby</h1>
      <p>${session.rosterCount} player(s) connected.</p>
      <button id="start-question-btn">Start Question</button>
      <button id="end-session-btn">End Session</button>
    </section>
  `
}

function renderQuestion(session) {
  const question = session.question
  const body = question
    ? `
      <h1>Question ${session.currentQuestionIndex + 1}</h1>
      <p>${escapeHtml(question.prompt)}</p>
      <p>Answers received: ${session.answeredCount} / ${session.rosterCount}</p>
      <button id="reveal-btn">Reveal Answer</button>
    `
    : `
      <h1>Question</h1>
      <p>Question ${session.currentQuestionIndex + 1} is not available yet.</p>
    `
  return `${renderHeader(session)}<section class="host-question">${body}</section><button id="end-session-btn">End Session</button>`
}

function renderReveal(session) {
  const question = session.question
  const answeredCount = session.answeredCount ?? 0

  if (!question) {
    return `
      ${renderHeader(session)}
      <section class="host-reveal">
        <h1>Reveal</h1>
        <p>Question data is unavailable.</p>
        <button id="advance-btn">Next Question</button>
      </section>
    `
  }

  const answersMarkup =
    answeredCount === 0
      ? `<p class="reveal-empty">No players answered this question.</p>`
      : `<p>${answeredCount} answer(s) submitted.</p>`

  const correctAnswerMarkup =
    typeof question.correctIndex === 'number'
      ? `<p>Correct answer: choice ${question.correctIndex + 1}</p>`
      : ''

  return `
    ${renderHeader(session)}
    <section class="host-reveal">
      <h1>Reveal</h1>
      <p>${escapeHtml(question.prompt)}</p>
      ${answersMarkup}
      ${correctAnswerMarkup}
      <button id="advance-btn">Next Question</button>
    </section>
  `
}

function renderScoreboard(session) {
  return `
    ${renderHeader(session)}
    <section class="host-scoreboard">
      <h1>Scoreboard</h1>
      <p>${session.scoreboardCount} player score entries available.</p>
    </section>
  `
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ---------- Event wiring ----------

function wireRetry() {
  document.getElementById('retry-btn')?.addEventListener('click', () => {
    const sessionId = getSessionIdFromUrl()
    if (sessionId) initHost(sessionId)
    else {
      state.isLoading = false
      state.loadError = null
      render()
    }
  })
}

function wireSetup() {
  document.getElementById('create-session-btn')?.addEventListener('click', async () => {
    const level = Number(document.getElementById('setup-level').value)
    const count = Number(document.getElementById('setup-count').value)
    const timer = Number(document.getElementById('setup-timer').value)

    try {
      const { session_id } = await api.createSession({ level, count, timer })
      const url = new URL(window.location.href)
      url.searchParams.set('session', session_id)
      window.history.replaceState({}, '', url)
      initHost(session_id)
    } catch (err) {
      console.error('[host] failed to create session', err)
      state.loadError = 'Failed to create session. Please try again.'
      render()
    }
  })
}

function wireControl(selector, apiFn) {
  const el = document.querySelector(selector)
  if (!el) return
  el.addEventListener('click', async () => {
    el.disabled = true
    try {
      await apiFn(getSessionIdFromUrl())
      await resyncHostState()
    } catch (err) {
      console.error('[host] control action failed', err)
      state.loadError = 'Action failed. Please retry.'
      render()
    } finally {
      el.disabled = false
    }
  })
}

// ---------- Data resync ----------

function getSessionIdFromUrl() {
  const params = new URL(window.location.href).searchParams
  return params.get('session') || params.get('code') || null
}

async function resyncHostState() {
  const sessionId = getSessionIdFromUrl()
  if (!sessionId) return
  if (resyncPromise) return resyncPromise

  resyncPromise = (async () => {
    try {
      const rawSession = await api.fetchSession(sessionId)
      const roster = await api.fetchRoster(sessionId)

      const next = {
        status: rawSession.status,
        joinCode: rawSession.join_code,
        currentQuestionIndex: rawSession.current_question_index ?? 0,
        totalQuestions: rawSession.question_count ?? 0,
        rosterCount: roster.length,
        answeredCount: 0,
        scoreboardCount: 0,
        question: null,
      }

      if (rawSession.status === 'question') {
        next.question = await api.fetchCurrentQuestion(sessionId)
        next.answeredCount = await api.fetchAnsweredCount(sessionId, next.currentQuestionIndex)
      } else if (rawSession.status === 'reveal') {
        next.question = await api.fetchRevealedQuestion(sessionId)
        next.answeredCount = await api.fetchAnsweredCount(sessionId, next.currentQuestionIndex)
      } else if (rawSession.status === 'scoreboard' || rawSession.status === 'ended') {
        const scoreboard = await api.fetchScoreboard(sessionId)
        next.scoreboardCount = scoreboard.length
      }

      state.isLoading = false
      state.loadError = null
      state.session = next
    } catch (err) {
      console.error('[host] failed to resync host state', err)
      state.isLoading = false
      state.loadError = 'Unable to load session. It may have ended or the code is invalid.'
    }

    render()
  })()

  try {
    await resyncPromise
  } finally {
    resyncPromise = null
  }
}

// ---------- Boot ----------

function handleSessionError(error) {
  console.error('[host] session subscribe error', error)
  state.isLoading = false
  state.loadError = 'Unable to load session.'
  render()
}

function initHost(sessionId) {
  state.isLoading = true
  state.loadError = null
  state.session = null
  render()

  if (channel) {
    channel.unsubscribe()
    channel = null
  }
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }

  resyncHostState()

  channel = joinSessionChannel(sessionId, {
    presenceKey: 'host',
    onChange: () => {
      resyncHostState()
    },
    onPresenceSync: () => {},
  })

  // Safety-net poll in case a broadcast is missed (e.g. brief disconnect).
  pollTimer = setInterval(() => {
    api.tryAdvanceIfExpired(sessionId).catch(() => {})
    resyncHostState()
  }, 5000)

  window.addEventListener('beforeunload', () => {
    if (channel) channel.unsubscribe()
    if (pollTimer) clearInterval(pollTimer)
  })
}

const initialSessionId = getSessionIdFromUrl()
if (initialSessionId) {
  initHost(initialSessionId)
} else {
  state.isLoading = false
  state.loadError = null
  state.session = null
  render()
}

export { initHost, render, state }
