import QRCode from 'qrcode'

// Set VITE_PLAYER_URL (see .env.example) to the deployed player-client app's
// base URL, e.g. https://play.trolleyquiz357.app — falls back to a local
// dev URL so `npm run dev` in both apps works together out of the box.
const PLAYER_BASE_URL = import.meta.env.VITE_PLAYER_URL || 'http://localhost:5174'

export async function renderJoinQr(canvasEl, joinCode) {
  const playerUrl = `${PLAYER_BASE_URL}/?code=${joinCode}`
  await QRCode.toCanvas(canvasEl, playerUrl, { width: 260, margin: 1 })
  return playerUrl
}
