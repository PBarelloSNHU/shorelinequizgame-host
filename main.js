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
  try {
    const created = await api.createSession({ level, count, timer })
    sessionId = created.session_id
    joinCode = created.join_code

    localStorage.setItem('tq357_host_session_id', sessionId)
    localStorage.setItem('tq357_host_join_code', joinCode)

    subscribeToSession()
    await resyncSessionState()
  } catch (err) {
    console.error('Failed to create host session:', err)
    resetToSetup()
  }
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
    expiryPoll = setInterval(async () => {
      if (session?.status !== 'question_live') return

      try {
        console.log('[host] tryAdvanceIfExpired tick', {
          sessionId,
          status: session.status,
          current_question_index: session.current_question_index,
        })

        await api.tryAdvanceIfExpired(sessionId)
      } catch (err) {
        console.warn('[host] tryAdvanceIfExpired failed:', err)
      }
    }, 1000)
  }
}

async function handleBroadcast(payload) {
  console.log(
    '[host] broadcast received:',
    payload?.table,
    payload?.record?.status,
    payload
  )

  const table = payload?.table

  if (table === 'quiz_sessions') {
    session = payload.record

    try {
      await resyncSessionState()
    } catch (err) {
      console.error('[host] resync after quiz_sessions broadcast failed:', err)
    }
    return
  }

  if (!sessionId) return

  if (table === 'quiz_players') {
    try {
      roster = await api.fetchRoster(sessionId)
      render()
    } catch (err) {
      console.warn('[host] failed to refresh roster:', err)
    }
    return
  }

  if (table === 'quiz_scores') {
    try {
      scoreboard = await api.fetchScoreboard(sessionId)
      render()
    } catch (err) {
      console.warn('[host] failed to refresh scoreboard:', err)
    }
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
      console.warn('[host] failed to refresh answered count:', err)
    }
  }
}

async function resyncSessionState() {
  if (!sessionId) return
  if (resyncPromise) return resyncPromise

  resyncPromise = (async () => {
    const freshSession = await api.fetchSession(sessionId)
    const freshRoster = await api.fetchRoster(sessionId)

    session = freshSession
    roster = freshRoster

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

    console.log('[host] resynced session state:', {
      status: session.status,
      rosterCount: roster.length,
      answeredCount,
      currentQuestionIndex: session.current_question_index,
      scoreboardCount: scoreboard.length,
    })

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

  console.log('[host] render status:', session.status)

  switch (session.status) {
    case 'lobby':
      renderLobby(app, {
        joinCode,
        roster,
        onStart: async () => {
          try {
            await api.startQuestion(sessionId)
          } catch (err) {
            console.error('[host] startQuestion failed:', err)
          }
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
          try {
            await api.revealQuestion(sessionId)
          } catch (err) {
            console.error('[host] revealQuestion failed:', err)
          }
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
          try {
            await api.advanceQuestion(sessionId)
          } catch (err) {
            console.error('[host] advanceQuestion failed:', err)
          }
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
      console.warn('[host] unknown session status:', session.status)
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
      console.error('[host] focus resync failed:', err)
    })
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sessionId) {
    resyncSessionState().catch((err) => {
      console.error('[host] visibility resync failed:', err)
    })
  }
})

boot()
