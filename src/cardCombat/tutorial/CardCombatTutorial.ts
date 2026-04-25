import Phaser from 'phaser'

const STORAGE_KEY = 'cardCombatTutorial:v1'

type SaveState = { done: boolean }

function loadSave(): SaveState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { done: false }
    const j = JSON.parse(raw) as SaveState
    return { done: j.done === true }
  } catch {
    return { done: false }
  }
}

function writeSave(s: SaveState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Добро пожаловать',
    body: 'Слева — журнал боя. Снизу — ваша «очередь» из 8 карт (2 ряда × 4 столбца). Играете всегда с левого столбца — он подсвечен.',
  },
  {
    title: 'Активный столбец',
    body: 'После каждого хода столбец сдвигается: карты уезжают влево, справа появляется новая. Так вы видите ближайшие 4 хода.',
  },
  {
    title: 'Выбор карты',
    body: 'В активном столбце две карты — верхняя и нижняя. Нажмите на нужную, чтобы разыграть её.',
  },
  {
    title: 'Тактика',
    body: 'У вас 5 очков тактики за весь матч. В активном столбце нажимайте «+ тактика» на карте — до +2 к её числу за этот ход.',
  },
  {
    title: 'Заклинания и существа',
    body: 'Заклинания бьют по герою или дают броню/лечение. Существа остаются на поле и сами атакуют после розыгрыша (провокация заставляет бить их первыми).',
  },
]

export class CardCombatTutorial {
  private readonly scene: Phaser.Scene
  private root: Phaser.GameObjects.Container | null = null
  private step = 0
  private helpBtn?: Phaser.GameObjects.Text

  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  static resetProgress(): void {
    localStorage.removeItem(STORAGE_KEY)
  }

  static isDone(): boolean {
    return loadSave().done
  }

  /** Кнопка «?» — повторить подсказки. */
  mountHelpButton(x: number, y: number): void {
    this.helpBtn?.destroy()
    this.helpBtn = this.scene.add
      .text(x, y, '?', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '16px',
        color: '#c9a227',
        backgroundColor: '#1a1528',
        padding: { left: 8, right: 8, top: 4, bottom: 4 },
      })
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(95)
    this.helpBtn.on('pointerdown', () => {
      this.step = 0
      writeSave({ done: false })
      this.showCurrentStep()
    })
  }

  /** Первый заход: показать шаг 0 после небольшой задержки. */
  startIfNewUser(delayMs = 500): void {
    if (loadSave().done) return
    this.scene.time.delayedCall(delayMs, () => this.showCurrentStep())
  }

  notifyPickedCard(): void {
    /* зарезервировано под условные шаги */
  }

  private destroyRoot(): void {
    this.root?.destroy(true)
    this.root = null
  }

  private showCurrentStep(): void {
    this.destroyRoot()
    if (this.step >= STEPS.length) {
      writeSave({ done: true })
      return
    }

    const W = this.scene.scale.width
    const H = this.scene.scale.height
    const root = this.scene.add.container(0, 0).setDepth(100)
    this.root = root

    const dim = this.scene.add.graphics()
    dim.fillStyle(0x050510, 0.72)
    dim.fillRect(0, 0, W, H)
    dim.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, W, H),
      Phaser.Geom.Rectangle.Contains
    )
    dim.on('pointerdown', () => {
      /* блок кликов по игре под оверлеем */
    })

    const step = STEPS[this.step]!
    const bx = W / 2
    const by = H - 120
    const pad = 16
    const maxW = Math.min(420, W - 24)
    const title = this.scene.add
      .text(0, 0, step.title, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '16px',
        color: '#f0ecf8',
        fontStyle: 'bold',
        wordWrap: { width: maxW - pad * 2 },
      })
      .setOrigin(0.5, 0)

    const body = this.scene.add
      .text(0, 0, step.body, {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '13px',
        color: '#c8c0d8',
        wordWrap: { width: maxW - pad * 2 },
      })
      .setOrigin(0.5, 0)

    title.setY(-pad - body.height - title.height - 8)
    body.setY(-pad - body.height)

    const bg = this.scene.add.graphics()
    const bw = maxW
    const bh = pad * 2 + title.height + body.height + 52
    bg.fillStyle(0x14141f, 0.98)
    bg.lineStyle(2, 0xc9a227, 0.85)
    bg.fillRoundedRect(-bw / 2, -bh + pad, bw, bh, 12)
    bg.strokeRoundedRect(-bw / 2, -bh + pad, bw, bh, 12)

    const btnSkip = this.scene.add
      .text(-bw / 2 + 18, -18, 'Пропустить', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '12px',
        color: '#9a93a8',
      })
      .setOrigin(0, 1)
      .setInteractive({ useHandCursor: true })
    btnSkip.on('pointerdown', () => {
      writeSave({ done: true })
      this.destroyRoot()
    })

    const btnNext = this.scene.add
      .text(bw / 2 - 18, -18, this.step === STEPS.length - 1 ? 'Готово' : 'Далее', {
        fontFamily: 'system-ui,Segoe UI,sans-serif',
        fontSize: '13px',
        color: '#c9a227',
        backgroundColor: '#1a1528',
        padding: { left: 12, right: 12, top: 6, bottom: 6 },
      })
      .setOrigin(1, 1)
      .setInteractive({ useHandCursor: true })
    btnNext.on('pointerdown', () => {
      this.step += 1
      if (this.step >= STEPS.length) {
        writeSave({ done: true })
        this.destroyRoot()
      } else {
        this.showCurrentStep()
      }
    })

    root.setPosition(bx, by)
    root.add([dim, bg, title, body, btnSkip, btnNext])
  }
}
