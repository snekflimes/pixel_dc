/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Если задан — клиент подключается к этому хосту вместо облака 0.peerjs.com */
  readonly VITE_PEERJS_HOST?: string
  readonly VITE_PEERJS_PORT?: string
  readonly VITE_PEERJS_PATH?: string
  readonly VITE_PEERJS_KEY?: string
  /** true / false; для localhost по умолчанию считается false */
  readonly VITE_PEERJS_SECURE?: string
}
