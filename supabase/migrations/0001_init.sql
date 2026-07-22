-- =====================================================================
-- Trolley Quiz 357 — schema, RLS, RPCs, and realtime triggers
-- Run this in the Supabase SQL editor (or via `supabase db push` if you
-- adopt the CLI), then run supabase/seed.sql.
--
-- Requires: Authentication > Providers > Anonymous sign-ins = ON.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

create table if not exists quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  join_code text unique not null,
  casas_level int not null check (casas_level between 1 and 5),
  status text not null default 'lobby'
    check (status in ('lobby', 'question_live', 'reveal', 'ended')),
  current_question_index int not null default 0,
  question_count int not null default 5,
  timer_seconds int not null default 20,
  question_started_at timestamptz,
  host_user_id uuid not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists quiz_questions (
  id uuid primary key default gen_random_uuid(),
  casas_level int not null check (casas_level between 1 and 5),
  prompt text not null,
  choices jsonb not null,
  correct_index int not null,
  topic text,
  created_at timestamptz not null default now()
);

create table if not exists quiz_session_questions (
  session_id uuid references quiz_sessions(id) on delete cascade,
  question_id uuid references quiz_questions(id),
  order_index int not null,
  primary key (session_id, order_index)
);

create table if not exists quiz_players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references quiz_sessions(id) on delete cascade,
  user_id uuid not null,
  display_name text not null,
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (session_id, display_name),
  unique (session_id, user_id)
);

create table if not exists quiz_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references quiz_sessions(id) on delete cascade,
  player_id uuid references quiz_players(id) on delete cascade,
  question_id uuid references quiz_questions(id),
  order_index int not null,
  selected_index int,
  is_correct boolean,
  response_ms int,
  submitted_at timestamptz not null default now(),
  unique (session_id, player_id, order_index)
);

create table if not exists quiz_scores (
  session_id uuid references quiz_sessions(id) on delete cascade,
  player_id uuid references quiz_players(id) on delete cascade,
  total_score int not null default 0,
  correct_count int not null default 0,
  primary key (session_id, player_id)
);

-- ---------------------------------------------------------------------
-- 2. Row Level Security
-- ---------------------------------------------------------------------

alter table quiz_sessions enable row level security;
alter table quiz_players enable row level security;
alter table quiz_responses enable row level security;
alter table quiz_scores enable row level security;
alter table quiz_questions enable row level security;

drop policy if exists "read sessions" on quiz_sessions;
drop policy if exists "read players" on quiz_players;
drop policy if exists "read scores" on quiz_scores;

create policy "read sessions"
on quiz_sessions
for select
using (auth.role() = 'authenticated');

create policy "read players"
on quiz_players
for select
using (auth.role() = 'authenticated');

create policy "read scores"
on quiz_scores
for select
using (auth.role() = 'authenticated');

grant select on public.quiz_sessions to authenticated;
grant select on public.quiz_players to authenticated;
grant select on public.quiz_scores to authenticated;

-- Deliberately NO select policy for quiz_questions or quiz_responses —
-- the answer key and raw responses are only ever touched inside the
-- security-definer RPCs below.

-- ---------------------------------------------------------------------
-- 3. Helper functions
-- ---------------------------------------------------------------------

create or replace function generate_join_code()
returns text
language plpgsql
as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_exists boolean;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, (floor(random() * length(v_chars)) + 1)::int, 1);
    end loop;

    select exists(
      select 1
      from quiz_sessions
      where join_code = v_code
        and status <> 'ended'
    )
    into v_exists;

    exit when not v_exists;
  end loop;

  return v_code;
end;
$$;

create or replace function score_for(p_response_ms int, p_timer_seconds int)
returns int
language sql
immutable
as $$
  select greatest(500, 1000 - floor(500.0 * p_response_ms / (p_timer_seconds * 1000)))::int;
$$;

-- ---------------------------------------------------------------------
-- 4. RPCs — host actions
-- ---------------------------------------------------------------------

create or replace function create_session(p_level int, p_count int, p_timer int)
returns table(join_code text, session_id uuid)
language plpgsql
security definer
as $$
declare
  v_join_code text := generate_join_code();
  v_session_id uuid;
begin
  insert into quiz_sessions (join_code, casas_level, question_count, timer_seconds, host_user_id)
  values (v_join_code, p_level, p_count, p_timer, auth.uid())
  returning id into v_session_id;

  insert into quiz_session_questions (session_id, question_id, order_index)
  select
    v_session_id,
    q.id,
    (row_number() over (order by random()) - 1)::int
  from quiz_questions q
  where q.casas_level = p_level
  order by random()
  limit p_count;

  return query
  select v_join_code, v_session_id;
end;
$$;

create or replace function start_question(p_session_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if auth.uid() <> (select host_user_id from quiz_sessions where id = p_session_id) then
    raise exception 'not_host';
  end if;

  update quiz_sessions
  set status = 'question_live',
      question_started_at = now()
  where id = p_session_id
    and status = 'lobby';
end;
$$;

create or replace function reveal_question(p_session_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if auth.uid() <> (select host_user_id from quiz_sessions where id = p_session_id) then
    raise exception 'not_host';
  end if;

  update quiz_sessions
  set status = 'reveal'
  where id = p_session_id
    and status = 'question_live';
end;
$$;

create or replace function advance_question(p_session_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_session record;
begin
  select *
  into v_session
  from quiz_sessions
  where id = p_session_id;

  if auth.uid() <> v_session.host_user_id then
    raise exception 'not_host';
  end if;

  if v_session.status <> 'reveal' then
    raise exception 'not_in_reveal';
  end if;

  if v_session.current_question_index + 1 >= v_session.question_count then
    update quiz_sessions
    set status = 'ended',
        ended_at = now()
    where id = p_session_id;
  else
    update quiz_sessions
    set current_question_index = current_question_index + 1,
        status = 'question_live',
        question_started_at = now()
    where id = p_session_id;
  end if;
end;
$$;

create or replace function end_session(p_session_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if auth.uid() <> (select host_user_id from quiz_sessions where id = p_session_id) then
    raise exception 'not_host';
  end if;

  update quiz_sessions
  set status = 'ended',
      ended_at = now()
  where id = p_session_id;
end;
$$;

create or replace function try_advance_if_expired(p_session_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_session record;
begin
  select *
  into v_session
  from quiz_sessions
  where id = p_session_id;

  if v_session.status = 'question_live'
     and now() > v_session.question_started_at + (v_session.timer_seconds || ' seconds')::interval then
    update quiz_sessions
    set status = 'reveal'
    where id = p_session_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. RPCs — player actions & shared read helpers
-- ---------------------------------------------------------------------

create or replace function join_session(p_code text, p_name text)
returns table(player_id uuid, session_id uuid, status text, current_question_index int)
language plpgsql
security definer
as $$
declare
  v_joined_session_id uuid;
  v_player_count int;
  v_player_id uuid;
begin
  select qs.id
  into v_joined_session_id
  from quiz_sessions qs
  where qs.join_code = upper(p_code)
    and qs.status <> 'ended';

  if v_joined_session_id is null then
    raise exception 'session_not_found';
  end if;

  select count(*)
  into v_player_count
  from quiz_players qp
  where qp.session_id = v_joined_session_id;

  if v_player_count >= 30 then
    raise exception 'session_full';
  end if;

  insert into quiz_players (session_id, user_id, display_name)
  values (v_joined_session_id, auth.uid(), p_name)
  on conflict (session_id, user_id)
  do update
    set connected = true,
        last_seen_at = now()
  returning id into v_player_id;

  return query
  select
    v_player_id,
    qs.id,
    qs.status,
    qs.current_question_index
  from quiz_sessions qs
  where qs.id = v_joined_session_id;
end;
$$;

create or replace function submit_answer(p_session_id uuid, p_order_index int, p_selected int)
returns boolean
language plpgsql
security definer
as $$
declare
  v_session record;
  v_player_id uuid;
  v_question_id uuid;
  v_correct int;
  v_is_correct boolean;
  v_response_ms int;
  v_points int;
begin
  select *
  into v_session
  from quiz_sessions
  where id = p_session_id;

  if v_session.status <> 'question_live' then
    raise exception 'not_accepting_answers';
  end if;

  if now() > v_session.question_started_at + (v_session.timer_seconds || ' seconds')::interval then
    raise exception 'answer_too_late';
  end if;

  select id
  into v_player_id
  from quiz_players
  where session_id = p_session_id
    and user_id = auth.uid();

  if v_player_id is null then
    raise exception 'not_joined';
  end if;

  select question_id
  into v_question_id
  from quiz_session_questions
  where session_id = p_session_id
    and order_index = p_order_index;

  select correct_index
  into v_correct
  from quiz_questions
  where id = v_question_id;

  v_is_correct := (v_correct = p_selected);
  v_response_ms := extract(epoch from (now() - v_session.question_started_at)) * 1000;
  v_points := case when v_is_correct then score_for(v_response_ms, v_session.timer_seconds) else 0 end;

  insert into quiz_responses (
    session_id,
    player_id,
    question_id,
    order_index,
    selected_index,
    is_correct,
    response_ms
  )
  values (
    p_session_id,
    v_player_id,
    v_question_id,
    p_order_index,
    p_selected,
    v_is_correct,
    v_response_ms
  )
  on conflict (session_id, player_id, order_index) do nothing;

  insert into quiz_scores (session_id, player_id, total_score, correct_count)
  values (
    p_session_id,
    v_player_id,
    v_points,
    case when v_is_correct then 1 else 0 end
  )
  on conflict (session_id, player_id)
  do update
    set total_score = quiz_scores.total_score + v_points,
        correct_count = quiz_scores.correct_count + (case when v_is_correct then 1 else 0 end);

  return v_is_correct;
end;
$$;

create or replace function get_current_question(p_session_id uuid)
returns table(order_index int, prompt text, choices jsonb, timer_seconds int, question_started_at timestamptz)
language plpgsql
security definer
as $$
begin
  return query
  select
    sq.order_index,
    q.prompt,
    q.choices,
    s.timer_seconds,
    s.question_started_at
  from quiz_sessions s
  join quiz_session_questions sq
    on sq.session_id = s.id
   and sq.order_index = s.current_question_index
  join quiz_questions q
    on q.id = sq.question_id
  where s.id = p_session_id;
end;
$$;

create or replace function get_revealed_question(p_session_id uuid)
returns table(order_index int, prompt text, choices jsonb, correct_index int)
language plpgsql
security definer
as $$
declare
  v_status text;
  v_idx int;
begin
  select status, current_question_index
  into v_status, v_idx
  from quiz_sessions
  where id = p_session_id;

  if v_status not in ('reveal', 'ended') then
    raise exception 'not_revealed_yet';
  end if;

  return query
  select
    sq.order_index,
    q.prompt,
    q.choices,
    q.correct_index
  from quiz_session_questions sq
  join quiz_questions q
    on q.id = sq.question_id
  where sq.session_id = p_session_id
    and sq.order_index = v_idx;
end;
$$;

grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------------
-- 6. Realtime: broadcast-from-database triggers
-- ---------------------------------------------------------------------

create or replace function broadcast_session_row()
returns trigger
language plpgsql
as $$
begin
  perform realtime.broadcast_changes(
    'session:' || new.id::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return new;
end;
$$;

drop trigger if exists trg_broadcast_session on quiz_sessions;
create trigger trg_broadcast_session
after insert or update on quiz_sessions
for each row execute function broadcast_session_row();

create or replace function broadcast_session_child_row()
returns trigger
language plpgsql
as $$
begin
  perform realtime.broadcast_changes(
    'session:' || new.session_id::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return new;
end;
$$;

drop trigger if exists trg_broadcast_players on quiz_players;
create trigger trg_broadcast_players
after insert or update on quiz_players
for each row execute function broadcast_session_child_row();

drop trigger if exists trg_broadcast_scores on quiz_scores;
create trigger trg_broadcast_scores
after insert or update on quiz_scores
for each row execute function broadcast_session_child_row();

drop trigger if exists trg_broadcast_responses on quiz_responses;
create trigger trg_broadcast_responses
after insert on quiz_responses
for each row execute function broadcast_session_child_row();

-- ---------------------------------------------------------------------
-- 7. Realtime Authorization
-- ---------------------------------------------------------------------

drop policy if exists "authenticated can receive broadcast and presence" on realtime.messages;
create policy "authenticated can receive broadcast and presence"
on realtime.messages
for select
to authenticated
using (true);

drop policy if exists "authenticated can send presence only" on realtime.messages;
create policy "authenticated can send presence only"
on realtime.messages
for insert
to authenticated
with check (extension = 'presence');
