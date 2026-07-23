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
    .select('id, status, join_code, casas_level, current_question_index, question_count, timer_seconds, question_started_at')
    .eq('id', sessionId)
    .single()

  if (error) throw error

  return {
    ...data,
    // Normalize to the field name main.js expects, sourced from the
    // NOT NULL question_count column rather than the nullable total_questions.
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

export async function tryAdvanceIfExpired(sessionId) {
  const { error } = await supabase.rpc('try_advance_if_expired', {
    p_session_id: sessionId,
  })
  if (error) throw error
}

// ---------- Question + answer data (host view) ----------

export async function fetchCurrentQuestionForHost(sessionId) {
  const { data, error } = await supabase.rpc('get_current_question_for_host', {
    p_session_id: sessionId,
  })
  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null

  return {
    question: {
      order_index: row.order_index,
      prompt: row.prompt,
      choices: row.choices,
    },
    answeredCount: row.answered_count ?? 0,
  }
}

export async function fetchRevealedQuestionForHost(sessionId) {
  const { data, error } = await supabase.rpc('get_revealed_question_for_host', {
    p_session_id: sessionId,
  })
  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null

  return {
    question: {
      order_index: row.order_index,
      prompt: row.prompt,
      choices: row.choices,
      correct_index: row.correct_index,
    },
    answeredCount: row.answered_count ?? 0,
  }
}

// ---------- Scoreboard ----------

export async function fetchScoreboard(sessionId) {
  const { data, error } = await supabase
    .from('quiz_scores')
    .select('player_id, total_score, correct_count, quiz_players(display_name)')
    .eq('session_id', sessionId)

  if (error) throw error
  return data ?? []
}
