import { supabase } from './supabaseClient.js'

// Thin wrappers around the Postgres RPCs. These are the host-side
// equivalent of what would have been Socket.io event emitters.

export async function createSession({ level, count, timer }) {
  const { data, error } = await supabase.rpc('create_session', {
    p_level: level,
    p_count: count,
    p_timer: timer,
  })
  if (error) throw error
  if (!data || !data.length) throw new Error('create_session returned no rows')
  return data[0] // { join_code, session_id }
}

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

export async function endSession(sessionId) {
  const { error } = await supabase.rpc('end_session', {
    p_session_id: sessionId,
  })
  if (error) throw error
}

export async function tryAdvanceIfExpired(sessionId) {
  const { error } = await supabase.rpc('try_advance_if_expired', {
    p_session_id: sessionId,
  })
  if (error) throw error
}

export async function fetchSession(sessionId) {
  const { data, error } = await supabase
    .from('quiz_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (error) throw error
  return data
}

export async function fetchRoster(sessionId) {
  const { data, error } = await supabase
    .from('quiz_players')
    .select('*')
    .eq('session_id', sessionId)
    .order('joined_at', { ascending: true })

  if (error) throw error
  return data
}

export async function fetchScoreboard(sessionId) {
  const { data, error } = await supabase
    .from('quiz_scores')
    .select('player_id, total_score, correct_count, quiz_players(display_name)')
    .eq('session_id', sessionId)
    .order('total_score', { ascending: false })

  if (error) throw error
  return data
}

export async function fetchAnsweredCount(sessionId, orderIndex) {
  const { count, error } = await supabase
    .from('quiz_responses')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('order_index', orderIndex)

  if (error) throw error
  return count ?? 0
}

export async function fetchCurrentQuestion(sessionId) {
  const { data, error } = await supabase.rpc('get_current_question', {
    p_session_id: sessionId,
  })
  if (error) throw error
  if (!data || !data.length) throw new Error('get_current_question returned no rows')
  return data[0]
}

export async function fetchRevealedQuestion(sessionId) {
  const { data, error } = await supabase.rpc('get_revealed_question', {
    p_session_id: sessionId,
  })
  if (error) throw error
  if (!data || !data.length) throw new Error('get_revealed_question returned no rows')
  return data[0]
}

