import Peer, { PeerError, util, type DataConnection, type PeerJSOption } from 'peerjs'

function parseEnvInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function parseEnvBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback
  const t = raw.toLowerCase()
  if (t === 'true' || t === '1' || t === 'yes') return true
  if (t === 'false' || t === '0' || t === 'no') return false
  return fallback
}

/** Облако PeerJS по умолчанию (часто даёт server-error — см. peerRuntimeOptions и scripts/peer-signal.mjs). */
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

/**
 * Сборка: задайте VITE_PEERJS_* (см. .env.example), иначе — облако или запрос peer-config.json.
 */
export function peerRuntimeOptions(): PeerJSOption {
  const host = import.meta.env.VITE_PEERJS_HOST?.trim()
  if (!host) {
    return peerCloudOptions()
  }
  const port = parseEnvInt(import.meta.env.VITE_PEERJS_PORT, 443)
  const pathStr = import.meta.env.VITE_PEERJS_PATH?.trim() || '/'
  const key = import.meta.env.VITE_PEERJS_KEY?.trim() || 'peerjs'
  const defaultSecure = host !== 'localhost' && host !== '127.0.0.1'
  const secure = parseEnvBool(import.meta.env.VITE_PEERJS_SECURE, defaultSecure)

  return {
    host,
    port,
    path: pathStr,
    secure,
    key,
    config: util.defaultConfig,
  }
}

let peerOptionsPromise: Promise<PeerJSOption> | null = null

/**
 * Порядок: 1) VITE_PEERJS_* при сборке; 2) GET peer-config.json рядом с приложением (FTP без пересборки);
 * 3) облако PeerJS (часто падает).
 */
export function loadPeerClientOptions(): Promise<PeerJSOption> {
  if (!peerOptionsPromise) {
    peerOptionsPromise = loadPeerClientOptionsOnce()
  }
  return peerOptionsPromise
}

async function loadPeerClientOptionsOnce(): Promise<PeerJSOption> {
  const envHost = import.meta.env.VITE_PEERJS_HOST?.trim()
  if (envHost) {
    return peerRuntimeOptions()
  }
  if (typeof window !== 'undefined') {
    try {
      const configUrl = new URL('peer-config.json', `${window.location.origin}${import.meta.env.BASE_URL}`)
      const res = await fetch(configUrl.href, { cache: 'no-store' })
      if (res.ok) {
        const j = (await res.json()) as Record<string, unknown>
        const h = typeof j.host === 'string' ? j.host.trim() : ''
        if (h) {
          const port =
            typeof j.port === 'number' && Number.isFinite(j.port) ? j.port : 443
          const pathStr = typeof j.path === 'string' && j.path ? j.path : '/'
          const key = typeof j.key === 'string' && j.key ? j.key : 'peerjs'
          const defaultSecure = h !== 'localhost' && h !== '127.0.0.1'
          const secure =
            typeof j.secure === 'boolean' ? j.secure : defaultSecure
          return {
            host: h,
            port,
            path: pathStr,
            secure,
            key,
            config: util.defaultConfig,
          }
        }
      }
    } catch {
      /* сеть / парсинг JSON */
    }
  }
  return peerCloudOptions()
}

/** PeerJS часто кидает PeerError с пустым message — для алерта показываем type и тело. */
export function formatPvpError(e: unknown): string {
  if (e instanceof PeerError) {
    const msg = (e.message && e.message.trim()) || ''
    const head = msg ? `${e.type}: ${msg}` : String(e.type)
    if (e.type === 'server-error') {
      return `${head}. Нужен свой PeerServer: файл peer-config.json в каталоге сайта, либо переменные VITE_PEERJS_* в GitHub Actions / .env (см. .env.example).`
    }
    return head
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
  /** Очки тактики на выбранной карте (0–2) за раунд. */
  cardBp: number
}

export function parsePvpData(raw: unknown): PvpPickMsg | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.type !== 'pick') return null
  const round = Number(o.round)
  const row = o.row === 0 || o.row === 1 ? o.row : null
  const cardId = typeof o.cardId === 'string' ? o.cardId : ''
  if (!Number.isFinite(round) || row === null || !cardId) return null
  const cardBp = Number(o.cardBp)
  const bp = Number.isFinite(cardBp) ? Math.max(0, Math.min(2, Math.floor(cardBp))) : 0
  return { type: 'pick', round, row, cardId, cardBp: bp }
}

/** Хост: новый Peer, возвращает id комнаты для второго игрока. */
export async function createHostPeer(): Promise<{ peer: Peer; id: string }> {
  const opts = await loadPeerClientOptions()
  return new Promise((resolve, reject) => {
    const peer = new Peer(opts)
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
export async function createClientAndConnect(hostId: string): Promise<{
  peer: Peer
  conn: DataConnection
}> {
  const opts = await loadPeerClientOptions()
  return new Promise((resolve, reject) => {
    const peer = new Peer(opts)
    peer.on('error', reject)
    peer.on('open', () => {
      const conn = peer.connect(hostId.trim(), { reliable: true })
      conn.on('error', reject)
      conn.on('open', () => resolve({ peer, conn }))
    })
  })
}
