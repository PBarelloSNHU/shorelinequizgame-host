import { renderJoinQr } from './qr.js'

// Each render* function owns one screen: it replaces #app's content and
// wires up its own event listeners. main.js decides WHICH one to call based
// on session.status coming from the realtime subscription — the views
// themselves never talk to Supabase directly.

export function renderSetup(container, { onCreate }) {
  container.innerHTML = `
    <div class="card">
      <h1>Trolley Quiz 357 — Host</h1>
      <label>CASAS Level
        <select id="level">${[1, 2, 3, 4, 5].map((l) => `<option value="${l}">${l}</option>`).join('')}</select>
      </label>
      <label>Questions
        <select id="count">${[4, 5, 6].map((c) => `<option value="${c}">${c}</option>`).join('')}</select>
      </label>
      <label>Timer (seconds)
        <select id="timer">${[15, 20, 30].map((t) => `<option value="${t}" ${t === 20 ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </label>
      <button id="createBtn">Create Session</button>
    </div>
  `
  container.querySelector('#createBtn').addEventListener('click', () => {
    onCreate({
      level: Number(container.querySelector('#level').value),
      count: Number(container.querySelector('#count').value),
      timer: Number(container.querySelector('#timer').value),
    })
  })
}

export async function renderLobby(container, { joinCode, roster, onStart }) {
  container.innerHTML = `
    <div class="card lobby">
      <h1>Join code: <span class="code">${joinCode}</span></h1>
      <canvas id="qr"></canvas>
      <p id="playerUrl" class="muted"></p>
      <h2>Players joined: <span>${roster.length}</span> / 30</h2>
      <ul id="rosterList">
        ${roster.map((p) => `<li>${p.display_name}${p.connected ? '' : ' (disconnected)'}</li>`).join('')}
      </ul>
      <button id="startBtn" ${roster.length === 0 ? 'disabled' : ''}>Start Quiz</button>
    </div>
  `
  const url = await renderJoinQr(container.querySelector('#qr'), joinCode)
  container.querySelector('#playerUrl').textContent = url
  container.querySelector('#startBtn').addEventListener('click', onStart)
}

export function renderQuestionLive(container, { question, session, answeredCount, rosterCount, onLockNow }) {
  const deadline = new Date(session.question_started_at).getTime() + session.timer_seconds * 1000
  container.innerHTML = `
    <div class="card">
      <h2>Question ${session.current_question_index + 1} / ${session.question_count}</h2>
      <p class="prompt">${question.prompt}</p>
      <ul class="choices">${question.choices.map((c) => `<li>${c}</li>`).join('')}</ul>
      <div id="countdown" class="countdown"></div>
      <p>${answeredCount} / ${rosterCount} answered</p>
      <button id="lockBtn">Lock now</button>
    </div>
  `
  container.querySelector('#lockBtn').addEventListener('click', onLockNow)

  const countdownEl = container.querySelector('#countdown')
  const interval = setInterval(tick, 250)
  tick()
  function tick() {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    countdownEl.textContent = `${remaining}s`
    if (remaining <= 0) clearInterval(interval)
  }
}

export function renderReveal(container, { question, correctIndex, scoreboard, isLastQuestion, onNext }) {
  container.innerHTML = `
    <div class="card">
      <h2>Answer</h2>
      <p class="prompt">${question.prompt}</p>
      <ul class="choices">
        ${question.choices.map((c, i) => `<li class="${i === correctIndex ? 'correct' : ''}">${c}</li>`).join('')}
      </ul>
      <h3>Scoreboard</h3>
      <ol>${scoreboard.map((row) => `<li>${row.quiz_players.display_name} — ${row.total_score} pts</li>`).join('')}</ol>
      <button id="nextBtn">${isLastQuestion ? 'Finish Quiz' : 'Next Question'}</button>
    </div>
  `
  container.querySelector('#nextBtn').addEventListener('click', onNext)
}

export function renderGameOver(container, { scoreboard, onNewSession }) {
  container.innerHTML = `
    <div class="card">
      <h1>Final Scoreboard</h1>
      <ol>
        ${scoreboard.map((row) => `<li>${row.quiz_players.display_name} — ${row.total_score} pts (${row.correct_count} correct)</li>`).join('')}
      </ol>
      <button id="newBtn">New Session</button>
    </div>
  `
  container.querySelector('#newBtn').addEventListener('click', onNewSession)
}
