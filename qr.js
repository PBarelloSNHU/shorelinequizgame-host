import QRCode from 'qrcode'

const PLAYER_BASE_URL =
  (import.meta.env.VITE_PLAYER_URL || 'http://localhost:5174').replace(/\/+$/, '')

export async function renderJoinQr(canvasEl, joinCode) {
  const playerUrl = `${PLAYER_BASE_URL}/?code=${joinCode}`
  await QRCode.toCanvas(canvasEl, playerUrl, { width: 260, margin: 1 })
  return playerUrl
}
