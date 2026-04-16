import type { CardDef, CardType } from '../cardCombat/types'
import {
  getAllCardsOrdered,
  resetCardsToDefault,
  saveAllCards,
} from '../db/cardStore'

/** Модальное окно: правка карт формами, без JSON. */
export async function openCardDatabaseEditor(): Promise<void> {
  let rows: CardDef[] = []
  try {
    rows = await getAllCardsOrdered()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    window.alert(`Не удалось загрузить карты: ${msg}`)
    return
  }

  const backdrop = document.createElement('div')
  backdrop.className = 'card-editor-backdrop'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-modal', 'true')

  const style = document.createElement('style')
  style.textContent = `
    .card-editor-backdrop{position:fixed;inset:0;background:rgba(7,8,14,.94);z-index:10000;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;}
    .card-editor-box{width:min(820px,100%);max-height:92vh;overflow:hidden;display:flex;flex-direction:column;background:#12121a;border:1px solid #c9a227;border-radius:10px;font:14px system-ui,"Segoe UI",sans-serif;color:#e8e4f0;}
    .card-editor-head{padding:14px 16px 10px;border-bottom:1px solid #2e303a;}
    .card-editor-head h2{margin:0;font-size:18px;font-weight:500;color:#f0ecf8;}
    .card-editor-hint{margin:8px 0 0;font-size:12px;color:#9a93a8;line-height:1.5;}
    .card-editor-scroll{flex:1;overflow:auto;padding:12px 16px;min-height:200px;}
    .card-editor-card{border:1px solid #2e303a;border-radius:8px;padding:12px;margin-bottom:12px;background:#16171d;}
    .card-editor-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;}
    .card-editor-card-head strong{color:#c9a227;font-size:13px;font-weight:500;}
    .card-editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
    @media (max-width: 640px){.card-editor-grid{grid-template-columns:1fr;}}
    .card-editor-field{display:flex;flex-direction:column;gap:4px;}
    .card-editor-field label{font-size:11px;color:#9a93a8;}
    .card-editor-field input,.card-editor-field select,.card-editor-field textarea{
      background:#0b0b12;color:#e8e4f0;border:1px solid #3a3a48;border-radius:6px;padding:8px 10px;font:inherit;box-sizing:border-box;}
    .card-editor-field textarea{min-height:52px;resize:vertical;}
    .card-editor-field-full{grid-column:1 / -1;}
    .card-editor-row{display:flex;align-items:center;gap:8px;}
    .card-editor-btn{cursor:pointer;padding:8px 14px;border-radius:6px;border:1px solid #3a3a48;background:#1a1a24;color:#e8e4f0;font:inherit;}
    .card-editor-btn:hover{background:#24242c;}
    .card-editor-btn-primary{border-color:#c9a227;background:#1a1528;color:#c9a227;}
    .card-editor-btn-primary:hover{background:#2a2040;}
    .card-editor-btn-danger{border-color:#6b3030;color:#e88888;}
    .card-editor-foot{display:flex;flex-wrap:wrap;gap:10px;padding:14px 16px;border-top:1px solid #2e303a;}
    .card-editor-muted{color:#7a7388;font-size:12px;margin-top:8px;}
  `

  const box = document.createElement('div')
  box.className = 'card-editor-box'

  const head = document.createElement('div')
  head.className = 'card-editor-head'
  const title = document.createElement('h2')
  title.textContent = 'Редактор карт'
  const hint = document.createElement('p')
  hint.className = 'card-editor-hint'
  hint.textContent =
    'Данные сохраняются только в этом браузере (IndexedDB). После выхода из редактора новые значения подхватит следующий бой. Чтобы вернуть набор с сайта после обновления игры, нажмите «Взять набор по умолчанию».'
  head.append(title, hint)

  const scroll = document.createElement('div')
  scroll.className = 'card-editor-scroll'

  const foot = document.createElement('div')
  foot.className = 'card-editor-foot'

  const mkBtn = (label: string, className: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = className
    b.textContent = label
    return b
  }

  const close = () => {
    document.removeEventListener('keydown', onKey)
    backdrop.remove()
    style.remove()
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close()
  }
  document.addEventListener('keydown', onKey)

  function newEmptyCard(): CardDef {
    return {
      id: `karta_${Date.now()}`,
      name: 'Новая карта',
      type: 'attack',
      description: '',
      enabled: true,
      damage: 4,
    }
  }

  function syncStatFields(c: CardDef): void {
    if (c.type === 'attack') {
      delete c.block
      delete c.heal
      if (c.damage === undefined) c.damage = 4
    } else if (c.type === 'defense') {
      delete c.damage
      delete c.heal
      if (c.block === undefined) c.block = 4
    } else {
      delete c.damage
      delete c.block
      if (c.heal === undefined) c.heal = 3
    }
  }

  function renderList(): void {
    scroll.innerHTML = ''
    rows.forEach((card, index) => {
      const wrap = document.createElement('div')
      wrap.className = 'card-editor-card'

      const headRow = document.createElement('div')
      headRow.className = 'card-editor-card-head'
      const num = document.createElement('strong')
      num.textContent = `Карта ${index + 1}`
      const del = mkBtn('Удалить', 'card-editor-btn card-editor-btn-danger')
      del.onclick = () => {
        if (rows.length <= 2) {
          window.alert('Нужно оставить минимум две карты в списке.')
          return
        }
        rows.splice(index, 1)
        renderList()
      }
      headRow.append(num, del)

      const grid = document.createElement('div')
      grid.className = 'card-editor-grid'

      const fId = field('Код в системе (латиница, без пробелов)', 'text', card.id, (v) => {
        card.id = v.trim()
      })
      const fName = field('Название', 'text', card.name, (v) => {
        card.name = v
      })

      const fType = document.createElement('div')
      fType.className = 'card-editor-field'
      const lt = document.createElement('label')
      lt.textContent = 'Тип'
      const sel = document.createElement('select')
      ;(
        [
          ['attack', 'Атака'],
          ['defense', 'Защита'],
          ['skill', 'Навык'],
        ] as [CardType, string][]
      ).forEach(([val, lab]) => {
        const o = document.createElement('option')
        o.value = val
        o.textContent = lab
        sel.append(o)
      })
      sel.value = card.type
      sel.onchange = () => {
        card.type = sel.value as CardType
        syncStatFields(card)
        renderList()
      }
      fType.append(lt, sel)

      const fDesc = document.createElement('div')
      fDesc.className = 'card-editor-field card-editor-field-full'
      const ldesc = document.createElement('label')
      ldesc.textContent = 'Описание'
      const ta = document.createElement('textarea')
      ta.value = card.description
      ta.oninput = () => {
        card.description = ta.value
      }
      fDesc.append(ldesc, ta)

      const fEn = document.createElement('div')
      fEn.className = 'card-editor-field card-editor-field-full'
      const row = document.createElement('div')
      row.className = 'card-editor-row'
      const chk = document.createElement('input')
      chk.type = 'checkbox'
      chk.checked = card.enabled !== false
      chk.id = `en_${index}_${card.id}`
      chk.onchange = () => {
        card.enabled = chk.checked
      }
      const lch = document.createElement('label')
      lch.htmlFor = chk.id
      lch.textContent = 'Участвует в колоде'
      row.append(chk, lch)
      fEn.append(row)

      grid.append(fId, fName, fType)

      if (card.type === 'attack') {
        grid.append(
          numField('Урон', card.damage ?? 0, (n) => {
            card.damage = n
          })
        )
      } else if (card.type === 'defense') {
        grid.append(
          numField('Блок', card.block ?? 0, (n) => {
            card.block = n
          })
        )
      } else {
        grid.append(
          numField('Лечение', card.heal ?? 0, (n) => {
            card.heal = n
          })
        )
      }

      grid.append(fDesc, fEn)

      wrap.append(headRow, grid)
      scroll.append(wrap)
    })
  }

  function field(
    label: string,
    inputType: 'text',
    value: string,
    onInput: (v: string) => void
  ): HTMLDivElement {
    const f = document.createElement('div')
    f.className = 'card-editor-field'
    const l = document.createElement('label')
    l.textContent = label
    const inp = document.createElement('input')
    inp.type = inputType
    inp.value = value
    inp.oninput = () => onInput(inp.value)
    f.append(l, inp)
    return f
  }

  function numField(
    label: string,
    value: number,
    onChange: (n: number) => void
  ): HTMLDivElement {
    const f = document.createElement('div')
    f.className = 'card-editor-field'
    const l = document.createElement('label')
    l.textContent = label
    const inp = document.createElement('input')
    inp.type = 'number'
    inp.min = '0'
    inp.step = '1'
    inp.value = String(value)
    inp.oninput = () => {
      const n = Number(inp.value)
      onChange(Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0)
    }
    f.append(l, inp)
    return f
  }

  const btnAdd = mkBtn('Добавить карту', 'card-editor-btn')
  btnAdd.onclick = () => {
    rows.push(newEmptyCard())
    renderList()
    scroll.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const btnSave = mkBtn('Сохранить', 'card-editor-btn card-editor-btn-primary')
  btnSave.onclick = async () => {
    try {
      await saveAllCards(rows)
      window.alert('Сохранено. Можно запускать бой — колода обновится.')
      close()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      window.alert(msg)
    }
  }

  const btnReset = mkBtn('Взять набор по умолчанию', 'card-editor-btn')
  btnReset.onclick = async () => {
    if (
      !window.confirm(
        'Заменить все карты на стандартный набор с сайта (или встроенный)? Текущие правки пропадут.'
      )
    ) {
      return
    }
    try {
      await resetCardsToDefault()
      rows = await getAllCardsOrdered()
      renderList()
      window.alert('Стандартный набор с сервера загружен и сохранён в браузере.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      window.alert(`Ошибка: ${msg}`)
    }
  }

  const btnClose = mkBtn('Закрыть без сохранения', 'card-editor-btn')
  btnClose.onclick = () => {
    close()
  }

  foot.append(btnAdd, btnSave, btnReset, btnClose)

  const muted = document.createElement('div')
  muted.className = 'card-editor-muted'
  muted.textContent =
    'Минимум две карты должны быть с галочкой «Участвует в колоде». Код карты (поле «Код») не должен повторяться.'

  box.append(head, scroll, muted, foot)
  backdrop.append(style, box)
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) close()
  })

  document.body.appendChild(backdrop)
  renderList()
}
