import { supabase } from './supabaseClient.js'

/**
 * Subscribes to the realtime channel for one session. All durable state
 * changes (session status, roster, scores, responses) arrive here as
 * broadcasts pushed by database triggers — this function never calls
 * channel.send() itself, it only listens. That's what guarantees a client
 * can't forge a fake state change: the only way a message shows up here is
 * because a permission-checked RPC actually wrote a row.
 *
 * Presence is layered on top separately for the ephemeral "who's connected
 * right now" indicator (no DB write needed just to show a green dot).
 */
export function joinSessionChannel(sessionId, { presenceKey, presencePayload, onChange, onPresenceSync }) {
  // `private: true` is required for the channel to be subject to the
  // Realtime Authorization RLS policies on realtime.messages (see
  // supabase/migrations/0001_init.sql §7) — without it, RLS is skipped
  // entirely and the broadcast-from-database triggers will never reach
  // this client.
  const channel = supabase.channel(`session:${sessionId}`, {
    config: { private: true, presence: { key: presenceKey } },
  })

  // realtime.broadcast_changes() sends the SQL operation (INSERT/UPDATE) as
  // the broadcast event name; payload.payload.table tells you which table
  // changed, payload.payload.record is the new row.
  channel.on('broadcast', { event: 'INSERT' }, (msg) => onChange?.(msg.payload))
  channel.on('broadcast', { event: 'UPDATE' }, (msg) => onChange?.(msg.payload))

  channel.on('presence', { event: 'sync' }, () => {
    onPresenceSync?.(channel.presenceState())
  })

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED' && presencePayload) {
      await channel.track(presencePayload)
    }
  })

  return channel
}
