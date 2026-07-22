import { ensureAnonymousSession } from './supabaseClient.js'
import * as api from './api.js'
import { joinSessionChannel } from './realtimeChannel.js'
import { renderSetup, renderLobby, renderQuestionLive, renderReveal, renderGameOver } from './views.js'

const app = document.querySelector('#app')

// Session state lives in localStorage only so this SAME browser tab can be
// refreshed mid-game without losing which session it's hosting. It is not
// how players find the game — that's the join code / QR.
let sessionId = localStorage.getItem('tq357_host_session_id')
let joinCode = localStorage.getItem('tq357_host_join_code')

let session = null
let roster = []
let scoreboard = []
let answeredCount = 0
let revealed = null
let channel = null
let expiryPoll = null

async function boot() {
  await ensureAnonymousSession()
  if (sessionId) {
    session = await api.fetchSession(sessionId)
    roster = await api.fetchRoster(sessionId)
    subscribeToSession()
    await refreshDerivedStateAndRender()
  } else {
    renderSetup(app, { onCreate: handleCreate })
  }
}

async function handleCreate({ level, count, timer }) {
  const created = await api.createSession({ level, count, timer })
  sessionId = created.session_id
  joinCode = created.join_code
  localStorage.setItem('tq357_host_session_id', sessionId)
  localStorage.setItem('tq357_host_join_code', joinCode)

  session = await api.fetchSession(sessionId)
  roster = []
  subscribeToSession()
  await refreshDerivedStateAndRender()
}

function subscribeToSession() {
  channel = joinSessionChannel(sessionId, {
    presenceKey: 'host',
    presencePayload: { role: 'host' },
    onChange: handleBroadcast,
    onPresenceSync: () => {}, // host doesn't need to render its own presence
  })

  // Resilience net (see architecture doc §9): nudge the server-side expiry
  // check every second while a question is live, in case no player client
  // happens to do it first.
  expiryPoll = setInterval(() => {
    if (session?.status === 'question_live') api.tryAdvanceIfExpired(sessionId)
  }, 1000)
}

async function handleBroadcast(payload) {
  const table = payload.table
  if (table === 'quiz_sessions') {
    session = payload.record
    await refreshDerivedStateAndRender()
  } else if (table === 'quiz_players') {
    roster = await api.fetchRoster(sessionId)
    render()
  } else if (table === 'quiz_scores') {
    scoreboard = await api.fetchScoreboard(sessionId)
    render()
  } else if (table === 'quiz_responses') {
    answeredCount = await api.fetchAnsweredCount(sessionId, session.current_question_index)
    render()
  }
}

// Fetches whatever extra data the CURRENT status needs before rendering —
// this runs once per status transition, not on every render.
async function refreshDerivedStateAndRender() {
  if (session.status === 'question_live') {
    answeredCount = await api.fetchAnsweredCount(sessionId, session.current_question_index)
  }
  if (session.status === 'reveal') {
    revealed = await api.fetchRevealedQuestion(sessionId)
    scoreboard = await api.fetchScoreboard(sessionId)
  }
  if (session.status === 'ended') {
    scoreboard = await api.fetchScoreboard(sessionId)
  }
  render()
}

function render() {
  switch (session.status) {
    case 'lobby':
      renderLobby(app, { joinCode, roster, onStart: () => api.startQuestion(sessionId) })
      break
    case 'question_live':
      api.fetchCurrentQuestion(sessionId).then((question) => {
        renderQuestionLive(app, {
          question,
          session,
          answeredCount,
          rosterCount: roster.length,
          onLockNow: () => api.revealQuestion(sessionId),
        })
      })
      break
    case 'reveal':
      renderReveal(app, {
        question: revealed,
        correctIndex: revealed.correct_index,
        scoreboard,
        isLastQuestion: session.current_question_index + 1 >= session.question_count,
        onNext: () => api.advanceQuestion(sessionId),
      })
      break
    case 'ended':
      renderGameOver(app, { scoreboard, onNewSession: handleNewSession })
      break
  }
}

function handleNewSession() {
  localStorage.removeItem('tq357_host_session_id')
  localStorage.removeItem('tq357_host_join_code')
  channel?.unsubscribe()
  clearInterval(expiryPoll)
  sessionId = null
  joinCode = null
  session = null
  renderSetup(app, { onCreate: handleCreate })
}

boot()
