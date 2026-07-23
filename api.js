// api.js — Shoreline Quiz Game Host
import { supabase } from './supabaseClient.js'

// ---------- Session lifecycle ----------

export async function createSession({ level, count, timerSeconds }) {
  const { data, error } = await supabase.rpc('create_session', {
    p_level: level,
    p_count: count,
    p_timer_seconds: timerSeconds,
  })
  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('create_session returned no data')

  return {
    session_id: row.session_id,
    join_code: row.join_code,
  }
}

export async function fetchSession(sessionId) {
  const { data, error } = await supabase
    .from('quiz_sessions')
    .select(
      'id, status, join_code, casas_level, current_question_index, question_count, timer_seconds, question_started_at'
    )
    .eq('id', sessionId)
    .single()

  if (error) throw error

  return {
    ...data,
    total_questions: data.question_count,
  }
}

export async function fetchRoster(sessionId) {
  const { data, error } = await supabase
    .from('quiz_players')
    .select('id, display_name')
    .eq('session_id', sessionId)

  if (error) throw error
  return data ?? []
}

export async function endSession(sessionId) {
  const { error } = await supabase.rpc('end_session', {
    p_session_id: sessionId,
  })
  if (error) throw error
}

// ---------- Question flow control ----------

export async function startQuestion(sessionId) {
  const { error } = await supabase.rpc('start_question', {
    p_session_id: sessionId,
  })
  if (error) throw error
}

export async function revealQuestion(sessionId) {
  const { error } = await supabase.rpc('reveal_question', {
    p_session_id: sessionId,
  })
  if (error) throw error
}

export async function advanceQuestion(sessionId) {
  const { error } = await supabase.rpc('advance_question', {
    p_session_id: sessionId,
  })
  if (error) throw error
}

// Called on a timer tick by the host UI to auto-advance once the
// question's timer window has elapsed, based on question_started_at
// + timer_seconds compared against the current time.
export async function tryAdvanceIfExpired(sessionId) {
  const session = await fetchSession(sessionId)

  if (session.status !== 'active') return false
  if (!session.question_started_at || !session.timer_seconds) return false

  const startedAt = new Date(session.question_started_at).getTime()
  const deadline = startedAt + session.timer_seconds * 1000

  if (Date.now() >= deadline) {
    await revealQuestion(sessionId)
    return true
  }

  return false
}

// ---------- Host-facing question + answer state ----------

export async function fetchCurrentQuestionForHost(sessionId) {
  const { data, error } = await supabase.rpc('get_current_question_for_host', {
    p_session_id: sessionId,
  })
  if (error) throw error
  return Array.isArray(data) ? data[0] ?? null : data
}

export async function fetchRevealedQuestionForHost(sessionId) {
  const { data, error } = await supabase.rpc('get_revealed_question_for_host', {
    p_session_id: sessionId,
  })
  if (error) throw error
  return Array.isArray(data) ? data[0] ?? null : data
}

// Convenience wrapper: fetches the right shape of question data
// depending on the session's current status.
export async function fetchQuestionForHost(sessionId, status) {
  if (status === 'reveal' || status === 'ended') {
    return fetchRevealedQuestionForHost(sessionId)
  }
  if (status === 'active') {
    return fetchCurrentQuestionForHost(sessionId)
  }
  return null
}

// ---------- Scores ----------

export async function fetchScores(sessionId) {
  const { data, error } = await supabase
    .from('quiz_scores')
    .select('player_id, score')
    .eq('session_id', sessionId)

  if (error) throw error
  return data ?? []
}

export async function fetchLeaderboard(sessionId) {
  const [{ data: scores, error: scoresError }, { data: players, error: playersError }] =
    await Promise.all([
      supabase.from('quiz_scores').select('player_id, score').eq('session_id', sessionId),
      supabase.from('quiz_players').select('id, display_name').eq('session_id', sessionId),
    ])

  if (scoresError) throw scoresError
  if (playersError) throw playersError

  const nameById = new Map((players ?? []).map((p) => [p.id, p.display_name]))

  return (scores ?? [])
    .map((s) => ({
      player_id: s.player_id,
      display_name: nameById.get(s.player_id) ?? 'Unknown',
      score: s.score,
    }))
    .sort((a, b) => b.score - a.score)
}

// ---------- Realtime subscriptions ----------

export function subscribeToSession(sessionId, onChange) {
  const channel = supabase
    .channel(`host-session-${sessionId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'quiz_sessions', filter: `id=eq.${sessionId}` },
      onChange
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

export function subscribeToRoster(sessionId, onChange) {
  const channel = supabase
    .channel(`host-roster-${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'quiz_players',
        filter: `session_id=eq.${sessionId}`,
      },
      onChange
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

export function subscribeToResponses(sessionId, onChange) {
  const channel = supabase
    .channel(`host-responses-${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'quiz_responses',
        filter: `session_id=eq.${sessionId}`,
      },
      onChange
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
