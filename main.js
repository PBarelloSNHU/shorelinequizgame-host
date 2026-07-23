// main.js — Shoreline Quiz Game Host
import * as api from './api.js'
import { joinSessionChannel } from './realtimeChannel.js'
import { ensureAnonymousSession } from './supabaseClient.js'

const state = {
  isLoading: true,
  loadError: null,
  session: null, // { status, joinCode, rosterCount, answeredCount, currentQuestionIndex, totalQuestions, question, scoreboard, timerSeconds, questionStartedAt }
}

const rootEl = document.getElementById('app')
let channel = null
let resyncPromise = null
let pollTimer = null
let timerInterval = null
let resyncFailureCount = 0
const MAX_RESYNC_FAILURES = 3

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
      stopTimer()
      break
    case 'question_live':
      rootEl.innerHTML = renderQuestion(state.session)
      wireControl('#reveal-btn', api.revealQuestion)
      wireControl('#end-session-btn', api.endSession)
      startTimer(state.session)
      break
    case 'reveal':
      rootEl.innerHTML = renderReveal(state.session)
      wireControl('#advance-btn', api.advanceQuestion)
      wireControl('#end-session-btn', api.endSession)
      stopTimer()
      break
    case 'ended':
      rootEl.innerHTML = renderScoreboard(state.session)
      wireNewSession()
      stopTimer()
      break
    default:
      rootEl.innerHTML = renderUnknownStatus(status)
      stopTimer()
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
      <label>CASAS Level
        <select id="setup-level">
          <option value="1">1 (Beginning)</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5 (Advanced)</option>
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
      <p>Join code: <strong>${escapeHtml(session.joinCode ?? '—')}</strong></p>
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
      <div class="timer-display" id="host-timer">--</div>
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
    typeof question.correct_index === 'number'
      ? `<p>Correct answer: choice ${question.correct_index + 1}</p>`
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
  const sorted = [...(session.scoreboard ?? [])].sort((a, b) => b.total_score - a.total_score)

  const rows = sorted
    .map((row, i) => {
      const name = escapeHtml(row.quiz_players?.display_name ?? row.player_id)
      return `
        <li>
          ${i + 1}. ${name} — ${row.total_score} pts (${row.correct_count} correct)
        </li>
      `
    })
    .join('')

  return `
    ${renderHeader(session)}
    <section class="host-scoreboard">
      <h1>Final Scoreboard</h1>
      <ol class="scoreboard-list">${rows || '<li>No scores recorded.</li>'}</ol>
      <button id="new-session-btn">Start New Session</button>
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

// ---------- Timer ----------

function startTimer(session) {
  stopTimer()
  if (!session.questionStartedAt || !session.timerSeconds) return

  const startedAt = new Date(session.questionStartedAt).getTime()
  const totalMs = session.timerSeconds * 1000
  const sessionId = getSessionIdFromUrl()

  const tick = () => {
    const el = document.getElementById('host-timer')
    if (!el) {
      stopTimer()
      return
    }
    const remainingMs = Math.max(0, startedAt + totalMs - Date.now())
    const remainingSec = Math.ceil(remainingMs / 1000)
    el.textContent = `${remainingSec}s`
    el.classList.toggle('timer-low', remainingSec <= 5)

    if (remainingMs <= 0) {
      stopTimer()
      api.tryAdvanceIfExpired(sessionId).catch(() => {})
      resyncHostState()
    }
  }

  tick()
  timerInterval = setInterval(tick, 250)
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

// ---------- Event wiring ----------

function wireRetry() {
  document.getElementById('retry-btn')?.addEventListener('click', () => {
    if (getSessionIdFromUrl()) {
      resyncFailureCount = 0
      resyncHostState()
    } else {
      state.isLoading = false
      state.loadError = null
      state.session = null
      render()
    }
  })
}

function wireSetup() {
  document.getElementById('create-session-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    const level = Number(document.getElementById('setup-level').value)
    const count = Number(document.getElementById('setup-count').value)
    const timerSeconds = Number(document.getElementById('setup-timer').value)

    try {
      await ensureAnonymousSession()
      const result = await api.createSession({ level, count, timerSeconds })
      setSessionIdInUrl(result.session_id)
      await bootSession(result.session_id)
    } catch (err) {
      console.error('[host] failed to create session', err)
      state.loadError = err.message ?? 'Unable to create session. Please try again.'
      render()
    } finally {
      btn.disabled = false
    }
  })
}

function wireControl(selector, apiFn) {
  document.querySelector(selector)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    const sessionId = getSessionIdFromUrl()
    try {
      await apiFn(sessionId)
      await resyncHostState()
    } catch (err) {
      console.error(`[host] action failed for ${selector}`, err)
    } finally {
      btn.disabled = false
    }
  })
}

function wireNewSession() {
  document.getElementById('new-session-btn')?.addEventListener('click', () => {
    clearSessionIdFromUrl()
    if (channel) {
      channel.unsubscribe()
      channel = null
    }
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    stopTimer()
    state.isLoading = false
    state.loadError = null
    state.session = null
    render()
  })
}

// ---------- URL-based session id ----------

function getSessionIdFromUrl() {
  return new URL(window.location.href).searchParams.get('session')
}

function setSessionIdInUrl(sessionId) {
  const url = new URL(window.location.href)
  url.searchParams.set('session', sessionId)
  window.history.replaceState({}, '', url)
}

function clearSessionIdFromUrl() {
  const url = new URL(window.location.href)
  url.searchParams.delete('session')
  window.history.replaceState({}, '', url)
}

// ---------- Data resync ----------

async function resyncHostState() {
  const sessionId = getSessionIdFromUrl()
  if (!sessionId) return
  if (resyncPromise) return resyncPromise

  resyncPromise = (async () => {
    try {
      const rawSession = await api.fetchSession(sessionId)
      const roster = await api.fetchRoster(sessionId)

      const nextSession = {
        status: rawSession.status,
        joinCode: rawSession.join_code,
        rosterCount: roster.length,
        answeredCount: 0,
        currentQuestionIndex: rawSession.current_question_index ?? 0,
        totalQuestions: rawSession.total_questions ?? 0,
        timerSeconds: rawSession.timer_seconds,
        questionStartedAt: rawSession.question_started_at,
        question: null,
        scoreboard: [],
      }

      if (rawSession.status === 'question_live') {
        const questionData = await api.fetchCurrentQuestionForHost(sessionId)
        nextSession.question = questionData?.question ?? null
        nextSession.answeredCount = questionData?.answeredCount ?? 0
      } else if (rawSession.status === 'reveal') {
        const questionData = await api.fetchRevealedQuestionForHost(sessionId)
        nextSession.question = questionData?.question ?? null
        nextSession.answeredCount = questionData?.answeredCount ?? 0
      } else if (rawSession.status === 'ended') {
        nextSession.scoreboard = await api.fetchScoreboard(sessionId)
      }

      state.session = nextSession
      state.isLoading = false
      state.loadError = null
      resyncFailureCount = 0
    } catch (err) {
      console.error('[host] failed to load session state', err)
      resyncFailureCount += 1

      if (resyncFailureCount >= MAX_RESYNC_FAILURES) {
        console.warn('[host] giving up on broken session, clearing session id')
        clearSessionIdFromUrl()
        if (channel) {
          channel.unsubscribe()
          channel = null
        }
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
        stopTimer()
        state.isLoading = false
        state.loadError = null
        state.session = null
        render()
        return
      }

      state.isLoading = false
      state.loadError = null // keep last known view rather than hard error, unless failures exceed threshold
    }

    console.log('[host] resynced host state:', {
      status: state.session?.status,
      rosterCount: state.session?.rosterCount,
      answeredCount: state.session?.answeredCount,
      currentQuestionIndex: state.session?.currentQuestionIndex,
      resyncFailureCount,
    })

    render()
  })()

  try {
    await resyncPromise
  } finally {
    resyncPromise = null
  }
}

// ---------- Boot ----------

async function bootSession(sessionId) {
  state.isLoading = true
  state.loadError = null
  render()

  if (channel) {
    channel.unsubscribe()
    channel = null
  }
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  stopTimer()

  await resyncHostState()

  channel = joinSessionChannel(sessionId, {
    presenceKey: 'host',
    presencePayload: { role: 'host' },
    onChange: () => {
      resyncHostState()
    },
    onPresenceSync: (presenceState) => {
      if (state.session) {
        state.session.rosterCount = Object.keys(presenceState).length || state.session.rosterCount
        if (state.session.status === 'lobby') render()
      }
    },
  })

  pollTimer = setInterval(() => {
    api.tryAdvanceIfExpired(sessionId).catch(() => {})
    resyncHostState()
  }, 5000)

  window.addEventListener('beforeunload', () => {
    if (channel) channel.unsubscribe()
    if (pollTimer) clearInterval(pollTimer)
    stopTimer()
  })
}

async function boot() {
  const sessionId = getSessionIdFromUrl()

  if (!sessionId) {
    state.isLoading = false
    state.loadError = null
    state.session = null
    render()
    return
  }

  try {
    await ensureAnonymousSession()
    await bootSession(sessionId)
  } catch (err) {
    console.error('[host] failed to resume session', err)
    clearSessionIdFromUrl()
    state.isLoading = false
    state.loadError = null
    state.session = null
    render()
  }
}

boot()

export { render, state }
