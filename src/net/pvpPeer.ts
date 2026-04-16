import Peer, { PeerError, util, type DataConnection, type PeerJSOption } from 'peerjs'

/** Явные настройки облачного PeerServer (как дефолты PeerJS, для прозрачности и будущей замены на свой хост). */
export function peerCloudOptions(): PeerJSOption {
  return {
    host: util.CLOUD_HOST,
    port: util.CLOUD_PORT,
    path: '/',
    secure: true,
    key: 'peerjs',
    config: util.defaultConfig,
  }
}

/** PeerJS часто кидает PeerError с пустым message — для алерта показываем type и тело. */
export function formatPvpError(e: unknown): string {
  if (e instanceof PeerError) {
    const msg = (e.message && e.message.trim()) || ''
    return msg ? `${e.type}: ${msg}` : String(e.type)
  }
  if (e instanceof Error) {
    const msg = (e.message && e.message.trim()) || ''
    return msg || e.name || 'Error'
  }
  if (typeof e === 'string') return e.trim() || '(пустая строка)'
  try {
    const s = JSON.stringify(e)
    return s === undefined ? String(e) : s
  } catch {
    return String(e)
  }
}

export type PvpPickMsg = {
  type: 'pick'
  round: number
  row: 0 | 1
  cardId: string
}

export function parsePvpData(raw: unknown): PvpPickMsg | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.type !== 'pick') return null
  const round = Number(o.round)
  const row = o.row === 0 || o.row === 1 ? o.row : null
  const cardId = typeof o.cardId === 'string' ? o.cardId : ''
  if (!Number.isFinite(round) || row === null || !cardId) return null
  return { type: 'pick', round, row, cardId }
}

/** Хост: новый Peer, возвращает id комнаты для второго игрока. */
export function createHostPeer(): Promise<{ peer: Peer; id: string }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerCloudOptions())
    const t = window.setTimeout(() => {
      peer.destroy()
      reject(new Error('Тайм-аут PeerJS (проверьте сеть или блокировщик)'))
    }, 20000)
    peer.on('open', (id) => {
      window.clearTimeout(t)
      resolve({ peer, id })
    })
    peer.on('error', (e) => {
      window.clearTimeout(t)
      reject(e)
    })
  })
}

export function waitForConnection(peer: Peer): Promise<DataConnection> {
  return new Promise((resolve) => {
    peer.on('connection', (conn) => {
      conn.on('open', () => resolve(conn))
    })
  })
}

/** Клиент: подключается к id хоста. */
export function createClientAndConnect(hostId: string): Promise<{ peer: Peer; conn: DataConnection }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerCloudOptions())
    peer.on('error', reject)
    peer.on('open', () => {
      const conn = peer.connect(hostId.trim(), { reliable: true })
      conn.on('error', reject)
      conn.on('open', () => resolve({ peer, conn }))
    })
  })
}
