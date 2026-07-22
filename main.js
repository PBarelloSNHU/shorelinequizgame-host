import { ensureAnonymousSession } from './supabaseClient.js'
import * as api from './api.js'
import { joinSessionChannel } from './realtimeChannel.js'
import {
  renderSetup,
  renderLobby,
  renderQuestionLive,
  renderReveal,
  renderGameOver,
} from './views.js'

const app = document.querySelector('#app')

let sessionId = localStorage.getItem('tq357_host_session_id')
let joinCode = localStorage.getItem('tq357_host_join_code')

let session = null
let roster = []
let scoreboard = []
let answeredCount = 0
let currentQuestion = null
let revealedQuestion = null
let channel = null
let expiryPoll = null
let resyncPromise = null

async function boot() {
  await ensureAnonymousSession()

  if (!sessionId) {
    renderSetup(app, { onCreate: handleCreate })
    return
  }

  try {
    subscribeToSession()
    await resyncSessionState()
  } catch (err) {
    console.error('Failed to restore host session:', err)
    resetToSetup()
  }
}

async function handleCreate({ level, count, timer }) {
  const created = await api.createSession({ level, count, timer })
  sessionId = created.session_id
  joinCode = created.join_code

  localStorage.setItem('tq357_host_session_id', sessionId)
  localStorage.setItem('tq357_host_join_code', joinCode)

  subscribeToSession()
  await resyncSessionState()
}

function subscribeToSession() {
  if (!sessionId || channel) return

  channel = joinSessionChannel(sessionId, {
    presenceKey: 'host',
    presencePayload: { role: 'host' },
    onChange: handleBroadcast,
    onPresenceSync: () => {},
  })

  if (!expiryPoll) {
    expiryPoll = setInterval(() => {
      if (session?.status === 'question_live') {
        api.tryAdvanceIfExpired(sessionId).catch((err) => {
          console.warn('tryAdvanceIfExpired failed:', err)
        })
      }
    }, 1000)
  }
}

async function handleBroadcast(payload) {
  const table = payload.table

  if (table === 'quiz_sessions') {
    session = payload.record
    await resyncSessionState()
    return
  }

  if (table === 'quiz_players') {
    roster = await api.fetchRoster(sessionId)
    render()
    return
  }

  if (table === 'quiz_scores') {
    scoreboard = await api.fetchScoreboard(sessionId)
    render()
    return
  }

  if (table === 'quiz_responses') {
    try {
      answeredCount = await api.fetchAnsweredCount(
        sessionId,
        session?.current_question_index ?? 0
      )
      render()
    } catch (err) {
      console.warn('Failed to refresh answered count:', err)
    }
  }
}

async function resyncSessionState() {
  if (!sessionId) return
  if (resyncPromise) return resyncPromise

  resyncPromise = (async () => {
    session = await api.fetchSession(sessionId)
    roster = await api.fetchRoster(sessionId)

    currentQuestion = null
    revealedQuestion = null
    answeredCount = 0

    if (session.status === 'lobby') {
      scoreboard = []
    } else if (session.status === 'question_live') {
      currentQuestion = await api.fetchCurrentQuestion(sessionId)
      answeredCount = await api.fetchAnsweredCount(
        sessionId,
        session.current_question_index
      )
    } else if (session.status === 'reveal') {
      revealedQuestion = await api.fetchRevealedQuestion(sessionId)
      scoreboard = await api.fetchScoreboard(sessionId)
    } else if (session.status === 'ended') {
      scoreboard = await api.fetchScoreboard(sessionId)
    }

    render()
  })()

  try {
    await resyncPromise
  } finally {
    resyncPromise = null
  }
}

function render() {
  if (!session) {
    renderSetup(app, { onCreate: handleCreate })
    return
  }

  switch (session.status) {
    case 'lobby':
      renderLobby(app, {
        joinCode,
        roster,
        onStart: async () => {
          await api.startQuestion(sessionId)
        },
      })
      break

    case 'question_live':
      if (!currentQuestion) return
      renderQuestionLive(app, {
        question: currentQuestion,
        session,
        answeredCount,
        rosterCount: roster.length,
        onLockNow: async () => {
          await api.revealQuestion(sessionId)
        },
      })
      break

    case 'reveal':
      if (!revealedQuestion) return
      renderReveal(app, {
        question: revealedQuestion,
        correctIndex: revealedQuestion.correct_index,
        scoreboard,
        isLastQuestion:
          session.current_question_index + 1 >= session.question_count,
        onNext: async () => {
          await api.advanceQuestion(sessionId)
        },
      })
      break

    case 'ended':
      renderGameOver(app, {
        scoreboard,
        onNewSession: handleNewSession,
      })
      break

    default:
      console.warn('Unknown session status:', session.status)
  }
}

function handleNewSession() {
  clearHostedSession()
  renderSetup(app, { onCreate: handleCreate })
}

function clearHostedSession() {
  localStorage.removeItem('tq357_host_session_id')
  localStorage.removeItem('tq357_host_join_code')

  if (channel) {
    channel.unsubscribe()
    channel = null
  }

  if (expiryPoll) {
    clearInterval(expiryPoll)
    expiryPoll = null
  }

  sessionId = null
  joinCode = null
  session = null
  roster = []
  scoreboard = []
  answeredCount = 0
  currentQuestion = null
  revealedQuestion = null
  resyncPromise = null
}

function resetToSetup() {
  clearHostedSession()
  renderSetup(app, { onCreate: handleCreate })
}

window.addEventListener('focus', () => {
  if (sessionId) {
    resyncSessionState().catch((err) => {
      console.error('Host focus resync failed:', err)
    })
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sessionId) {
    resyncSessionState().catch((err) => {
      console.error('Host visibility resync failed:', err)
    })
  }
})

boot()
