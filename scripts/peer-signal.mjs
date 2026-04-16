/**
 * Локальный или прод-сервер сигнализации PeerJS (пакет `peer`).
 * Запуск: PEER_PORT=9000 node scripts/peer-signal.mjs
 * В .env для dev: VITE_PEERJS_HOST=localhost VITE_PEERJS_PORT=9000 VITE_PEERJS_SECURE=false
 */
import { PeerServer } from 'peer'

// Render/Fly/Vercel-like platforms typically provide PORT.
const port = Number(process.env.PORT ?? process.env.PEER_PORT ?? 9000)
const path = process.env.PEER_PATH ?? '/'
const key = process.env.PEER_KEY ?? 'peerjs'

PeerServer({ port, path, key }, () => {
  console.log(`[peer-signal] listening port=${port} path=${path} key=${key}`)
})
