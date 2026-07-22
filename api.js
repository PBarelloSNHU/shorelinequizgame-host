import { supabase } from './supabaseClient.js'

function normalizeError(error, context) {
  if (!error) return null

  const normalized = {
    message: error.message || `${context} failed`,
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
    context,
    raw: error,
  }

  console.error(`[api] ${context}`, normalized)
  return normalized
}

function throwNormalized(error, context) {
  const normalized = normalizeError(error, context)
  if (normalized) throw normalized
}

function isExpectedNoopError(error) {
  if (!error) return false
  const msg = (error.message || '').toLowerCase()

  return (
    msg === '' ||
    msg === 'not_in_reveal' ||
    msg === 'not_revealed_yet' ||
    msg === 'not_accepting_answers' ||
    msg.includes('networkerror when attempting to fetch resource')
  )
}

export async function createSession({ level, count, timer }) {
  const { data, error } = await supabase.rpc('create_session', {
    p_level: level,
    p_count: count,
    p_timer: timer,
  })

  throwNormalized(error, 'create_session')

  if (!Array.isArray(data) || !data[0]) {
    throw {
      message: 'create_session returned no data',
      code: 'HOST_API_EMPTY_RESULT',
      details: null,
      hint: null,
      context: 'create_session',
      raw: data,
    }
  }

  return data[0]
}

export async function startQuestion(sessionId) {
  const { error } = await supabase.rpc('start_question', {
    p_session_id: sessionId,
  })

  throwNormalized(error, 'start_question')
  return { ok: true }
}

export async function revealQuestion(sessionId) {
  const { error } = await supabase.rpc('reveal_question', {
    p_session_id: sessionId,
  })

  throwNormalized(error, 'reveal_question')
  return { ok: true }
}

export async function advanceQuestion(sessionId) {
  const { error } = await supabase.rpc('advance_question', {
    p_session_id: sessionId,
  })

  if (error) {
    if ((error.message || '').toLowerCase() === 'not_in_reveal') {
      console.warn('[api] advance_question ignored: session is not in reveal yet', error)
      return {
        ok: false,
        ignored: true,
        reason: 'not_in_reveal',
      }
    }

    throwNormalized(error, 'advance_question')
  }

  return { ok: true }
}

export async function endSession(sessionId) {
  const { error } = await supabase.rpc('end_session', {
    p_session_id: sessionId,
  })

  throwNormalized(error, 'end_session')
  return { ok: true }
}

export async function tryAdvanceIfExpired(sessionId) {
  const { error } = await supabase.rpc('try_advance_if_expired', {
    p_session_id: sessionId,
  })

  if (error) {
    if (isExpectedNoopError(error)) {
      console.debug('[api] try_advance_if_expired noop', error)
      return {
        ok: false,
        ignored: true,
        reason: error.message || 'noop',
      }
    }

    throwNormalized(error, 'try_advance_if_expired')
  }

  return { ok: true }
}

export async function fetchSession(sessionId) {
  const { data, error } = await supabase
    .from('quiz_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  throwNormalized(error, 'fetchSession')
  return data
}

export async function fetchRoster(sessionId) {
  const { data, error } = await supabase
    .from('quiz_players')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })

  throwNormalized(error, 'fetchRoster')
  return data ?? []
}

export async function fetchScoreboard(sessionId) {
  const { data, error } = await supabase
    .from('quiz_scores')
    .select('player_id, total_score, correct_count, quiz_players(display_name)')
    .eq('session_id', sessionId)
    .order('total_score', { ascending: false })

  throwNormalized(error, 'fetchScoreboard')
  return data ?? []
}

export async function fetchAnsweredCount(sessionId, orderIndex) {
  const { data, error } = await supabase.rpc('get_answered_count', {
    p_session_id: sessionId,
    p_order_index: orderIndex,
  })

  throwNormalized(error, 'fetchAnsweredCount')
  return data ?? 0
}

export async function fetchCurrentQuestion(sessionId) {
  const { data, error } = await supabase.rpc('get_current_question', {
    p_session_id: sessionId,
  })

  throwNormalized(error, 'get_current_question')
  return Array.isArray(data) ? (data[0] ?? null) : null
}

export async function fetchRevealedQuestion(sessionId) {
  const { data, error } = await supabase.rpc('get_revealed_question', {
    p_session_id: sessionId,
  })

  if (error) {
    if ((error.message || '').toLowerCase() === 'not_revealed_yet') {
      console.warn('[api] get_revealed_question ignored: not revealed yet', error)
      return null
    }

    throwNormalized(error, 'get_revealed_question')
  }

  return Array.isArray(data) ? (data[0] ?? null) : null
}
