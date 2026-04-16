import {
  exportCardsJsonPretty,
  resetCardsToDefault,
  saveAllCardsFromJson,
} from '../db/cardStore'

/** Модальное окно поверх Phaser: правка JSON карт в IndexedDB. */
export async function openCardDatabaseEditor(): Promise<void> {
  let text = ''
  try {
    text = await exportCardsJsonPretty()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    window.alert(`Не удалось прочитать базу: ${msg}`)
    return
  }

  const backdrop = document.createElement('div')
  backdrop.style.cssText =
    'position:fixed;inset:0;background:rgba(7,8,14,.92);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;'

  const box = document.createElement('div')
  box.style.cssText =
    'width:min(760px,100%);max-height:90vh;overflow:auto;background:#12121a;border:1px solid #c9a227;border-radius:10px;padding:16px;font:14px system-ui,Segoe UI,sans-serif;color:#e8e4f0;'

  const title = document.createElement('h2')
  title.style.cssText = 'margin:0 0 12px;font-size:18px;font-weight:500;color:#f0ecf8'
  title.textContent = 'База карт (IndexedDB в браузере)'

  const hint = document.createElement('p')
  hint.style.cssText = 'margin:0 0 12px;font-size:12px;color:#9a93a8;line-height:1.45'
  hint.innerHTML =
    'Данные лежат локально в IndexedDB (Dexie), не на FTP. Сервер только отдаёт статику и файл <code>/data/cards.json</code> как <strong>начальный сид</strong> при пустой базе. После правок здесь загрузится уже ваше состояние из браузера.'

  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText =
    'width:100%;min-height:280px;box-sizing:border-box;background:#0b0b12;color:#e8e4f0;border:1px solid #2e303a;border-radius:6px;padding:10px;font:12px ui-monospace,Consolas,monospace;resize:vertical'

  const row = document.createElement('div')
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin-top:14px'

  const mkBtn = (label: string, primary: boolean) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.style.cssText = primary
      ? 'cursor:pointer;padding:10px 18px;border-radius:6px;border:1px solid #c9a227;background:#1a1528;color:#c9a227;font:inherit'
      : 'cursor:pointer;padding:10px 18px;border-radius:6px;border:1px solid #3a3a48;background:#1a1a24;color:#b8b0c4;font:inherit'
    return b
  }

  const close = () => {
    backdrop.remove()
  }

  const btnSave = mkBtn('Сохранить в IndexedDB', true)
  btnSave.onclick = async () => {
    try {
      await saveAllCardsFromJson(ta.value)
      window.alert('Сохранено. Новые бои подхватят колоду при следующем входе в «В бой» (или перезапустите сцену боя).')
      close()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      window.alert(`Ошибка: ${msg}`)
    }
  }

  const btnReset = mkBtn('Сбросить к /data/cards.json (сервер)', false)
  btnReset.onclick = async () => {
    if (!window.confirm('Перезаписать базу данными по умолчанию с сервера (или встроенным сидом)?')) return
    try {
      await resetCardsToDefault()
      ta.value = await exportCardsJsonPretty()
      window.alert('Сброс выполнен.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      window.alert(`Ошибка: ${msg}`)
    }
  }

  const btnClose = mkBtn('Закрыть', false)
  btnClose.onclick = close

  row.append(btnSave, btnReset, btnClose)
  box.append(title, hint, ta, row)
  backdrop.append(box)
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) close()
  })
  document.body.appendChild(backdrop)
  ta.focus()
}
