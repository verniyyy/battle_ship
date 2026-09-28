import { useEffect, useMemo, useRef, useState } from 'react'
import type { Scene } from '../App'
import { api } from '../api'
import { audio } from '../audio'
import { Board, CellOverlay } from '../components/Board'
import { CutinLayer, flyPlane, flyShell, FloatText, GaugeBar, runTorpedo, ShipPlate, type Cutin, type Float } from '../components/battle'
import { Backdrop, ShipToken, SoundToggle } from '../components/ui'
import { fx, RAINBOW } from '../fx'
import { CLASS_INFO, describe, footprint, historyLog, lookOfShip, SKILL_INFO, SPECIAL_INFO, stageLabel, TORPEDO_INFO, WEATHER_INFO, type Look, type LogLine } from '../game'
import { useGame } from '../state'
import { posLabel, samePos, type ActionType, type GameView, type MatchResponse, type Pos, type Result, type Reward, type Shot, type ShipView, type Special } from '../types'
import { ResultOverlay } from './Result'

type Marker = 'hit' | 'splash' | 'miss' | 'enemy-fire'

// Markers for the most recent round only: older reports are stale once ships move.
function lastRoundMarkers(game: GameView): Map<string, Marker> {
  const m = new Map<string, Marker>()
  const h = game.history
  let start = h.length - 1
  while (start > 0 && h[start].side !== 'player') start--
  for (const r of h.slice(Math.max(start, 0))) {
    for (const s of r.shots ?? []) {
      const k = `${s.target.row},${s.target.col}`
      if (r.side === 'cpu') m.set(k, 'enemy-fire')
      else m.set(k, (s.damage ?? 0) > 0 ? 'hit' : s.splash ? 'splash' : 'miss')
    }
  }
  return m
}

// ---- intermediate views while an action plays out ----

function patchShot(g: GameView, shot: Shot, mine: boolean): GameView {
  if (shot.hitShipId === undefined || !shot.damage) return g
  const key = mine ? 'enemyShips' : 'playerShips'
  return { ...g, [key]: g[key].map((s) => (s.id === shot.hitShipId ? { ...s, hp: Math.max(0, s.hp - shot.damage!) } : s)) }
}

function shift(p: Pos, dir: Result['direction'], n: number): Pos {
  switch (dir) {
    case 'north':
      return { row: p.row - n, col: p.col }
    case 'south':
      return { row: p.row + n, col: p.col }
    case 'east':
      return { row: p.row, col: p.col + n }
    default:
      return { row: p.row, col: p.col - n }
  }
}

function patchMeta(g: GameView, r: Result): GameView {
  const mine = r.side === 'player'
  let player = g.playerShips
  let enemy = g.enemyShips
  const own = (f: (s: GameView['playerShips'][number]) => GameView['playerShips'][number]) => {
    if (mine) player = player.map((s) => (s.id === r.shipId ? f(s) : s))
    else enemy = enemy.map((s) => (s.id === r.shipId ? f(s) : s))
  }
  if (r.cancelled) return g
  if (r.type === 'attack') own((s) => ({ ...s, ammo: s.ammo - 1 }))
  if (r.type === 'torpedo') own((s) => ({ ...s, torps: s.torps - 1 }))
  if (r.type === 'skill') own((s) => ({ ...s, skill: s.skill - 1 }))
  // A torpedo wake gives the launcher away.
  if (!mine && r.origin) own((s) => ({ ...s, pos: r.origin, spotted: true }))
  if (r.type === 'move') {
    if (mine) own((s) => ({ ...s, pos: r.target }))
    else
      own((s) =>
        r.hidden ? { ...s, pos: undefined, spotted: false } : s.pos && s.spotted ? { ...s, pos: shift(s.pos, r.direction, r.distance ?? 0) } : s,
      )
  }
  if (mine && r.revealed?.length) {
    enemy = enemy.map((s) => {
      const seen = r.revealed!.find((v) => v.shipId === s.id)
      return seen ? { ...s, pos: seen.pos, spotted: true } : s
    })
  }
  if (mine) {
    for (const sh of r.shots ?? []) {
      if (sh.hitShipId !== undefined && !sh.sunk) enemy = enemy.map((s) => (s.id === sh.hitShipId ? { ...s, pos: sh.target, spotted: true } : s))
    }
  }
  return {
    ...g,
    playerShips: player,
    enemyShips: enemy,
    gauge: mine ? r.gauge : g.gauge,
    enemyGauge: mine ? g.enemyGauge : r.gauge,
    combo: mine ? r.combo : g.combo,
  }
}

// predictSpecial says which situational attack the aimed action would trigger,
// mirroring the rules on the server (point-blank is a forecast: the ship may dodge or move).
function predictSpecial(g: GameView, ship: ShipView | null, mode: ActionType | null, aim: Pos | null): Special | undefined {
  if (!ship || !mode || !aim || !ship.pos) return undefined
  const tracked = (p: Pos) => g.enemyShips.some((e) => e.hp > 0 && e.spotted && samePos(e.pos, p))
  if (mode === 'attack' && (ship.class === 'battleship' || ship.class === 'cruiser') && samePos(g.lastGun, aim)) return 'spotting'
  if (mode === 'skill' && ship.skillKind === 'airstrike' && tracked(aim)) return 'precision'
  if (mode === 'torpedo' || (mode === 'skill' && ship.skillKind === 'spread')) {
    const from = ship.pos
    const cells = footprint(g.boardSize, mode, ship.skillKind, ship.class, from, aim)
    const near = cells.find((c) => g.enemyShips.some((e) => e.hp > 0 && e.spotted && e.class !== 'submarine' && samePos(e.pos, c)))
    if (near && Math.max(Math.abs(near.row - from.row), Math.abs(near.col - from.col)) <= 2) return 'pointblank'
  }
  return undefined
}

const SPEED_KEY = 'battleSpeed'
function loadSpeed() {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY))
    return v === 2 || v === 3 ? v : 1
  } catch {
    return 1
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

export function Battle({ initial, resumed, onFinished, go }: { initial: MatchResponse; resumed?: boolean; onFinished: () => void; go: (s: Scene) => void }) {
  const { catalog, card, setProfile } = useGame()
  const gameId = initial.id
  const stage = initial.stage
  const [game, setGame] = useState(initial.game)
  const [reward, setReward] = useState<Reward | undefined>(initial.reward)
  const [selected, setSelected] = useState<number | null>(null)
  const [mode, setMode] = useState<ActionType | null>(null)
  const [target, setTarget] = useState<Pos | null>(null)
  const [hover, setHover] = useState<Pos | null>(null)
  const [busy, setBusy] = useState(false)
  const [cutin, setCutin] = useState<Cutin | null>(null)
  const [floats, setFloats] = useState<Float[]>([])
  const [lit, setLit] = useState<{ cells: Pos[]; kind: 'flare' | 'sonar' } | null>(null)
  const [log, setLog] = useState<LogLine[]>(() => historyLog(initial.game))
  const [showResult, setShowResult] = useState(initial.game.status === 'finished')
  const [speed, setSpeed] = useState(loadSpeed)
  const [combo, setCombo] = useState<{ n: number; key: number } | null>(null)
  const mounted = useRef(true)
  const speedRef = useRef(speed)
  const skip = useRef<(() => void) | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const floatSeq = useRef(0)
  speedRef.current = speed

  const looks = useMemo(
    () => ({
      player: game.playerShips.map((s) => lookOfShip(catalog, s, false)),
      enemy: game.enemyShips.map((s) => lookOfShip(catalog, s, true)),
    }),
    // Looks depend on identity, not on HP, so the initial fleets are enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog],
  )

  // wait sleeps for a (speed-adjusted) duration; a tap on the cut-in ends it early.
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(done, ms / speedRef.current)
      function done() {
        clearTimeout(t)
        skip.current = null
        resolve()
      }
      skip.current = done
    })
  const ms = (n: number) => n / speedRef.current

  const show = async (c: Cutin, dur: number) => {
    if (!mounted.current) return
    setCutin(c)
    await wait(dur)
    if (mounted.current) setCutin(null)
  }

  const cellEl = (p: Pos) => boardRef.current?.querySelector(`[data-cell="${p.row}-${p.col}"]`)
  const cellPt = (p: Pos) => fx.center(cellEl(p))

  const float = (at: Pos, text: string, kind: Float['kind']) => {
    const id = ++floatSeq.current
    setFloats((f) => [...f, { id, at, text, kind }])
    window.setTimeout(() => mounted.current && setFloats((f) => f.filter((x) => x.id !== id)), 1400)
  }

  useEffect(() => {
    mounted.current = true
    if (initial.game.status !== 'finished') {
      ;(async () => {
        setBusy(true)
        audio.play('alarm')
        const w = WEATHER_INFO[initial.game.weather ?? 'clear']
        if (resumed || initial.game.history.length > 0) {
          await show({ kind: 'intro', text: '敵艦隊 見ゆ！', sub: `${stageLabel(stage)} ${stage.name}` }, 1300)
        } else {
          await show({ kind: 'intro', text: '索敵開始！', sub: `${stageLabel(stage)} ${stage.name}` }, 1100)
          if (initial.game.weather !== 'clear') await show({ kind: 'banner', text: `${w.icon} ${w.name}`, sub: w.desc, tone: 'blue' }, 1300)
          if (stage.boss) {
            audio.play('bigboom')
            fx.shake(16, 600)
            await show({ kind: 'banner', text: '⚠ 敵旗艦 出現 ⚠', sub: game.enemyShips.find((s) => s.boss)?.name, tone: 'red' }, 1600)
          } else {
            await show({ kind: 'intro', text: '敵艦隊発見！', sub: `敵 ${game.enemyShips.length} 隻 ／ ${stage.size}×${stage.size} 海域` }, 1200)
          }
        }
        if (mounted.current) setBusy(false)
      })()
    }
    return () => {
      mounted.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finished = game.status === 'finished'
  const ship = selected !== null ? game.playerShips[selected] : null
  const flagship = game.playerShips.find((s) => s.hp > 0)
  const canUlt = game.gauge >= 100 && !finished
  const allCells = useMemo(() => Array.from({ length: game.boardSize ** 2 }, (_, i) => ({ row: Math.floor(i / game.boardSize), col: i % game.boardSize })), [game.boardSize])
  const targets: Pos[] =
    mode === 'ultimate'
      ? allCells
      : ship && mode
        ? ((mode === 'attack' ? ship.attackTargets : mode === 'torpedo' ? ship.torpedoTargets : mode === 'move' ? ship.moveTargets : ship.skillTargets) ?? [])
        : []
  const markers = lastRoundMarkers(game)
  const turn = game.turn + (finished ? 0 : 1)
  const turnsLeft = game.maxTurns ? game.maxTurns - game.turn : undefined
  // Once a target is chosen the preview stays on it; hovering only aims before that.
  const aim = target ?? (hover && targets.some((t) => samePos(t, hover)) ? hover : null)
  const actorPos = mode === 'ultimate' ? flagship?.pos : ship?.pos
  const preview = aim && mode && mode !== 'move' && actorPos ? footprint(game.boardSize, mode, ship?.skillKind, ship?.class, actorPos, aim) : []
  const special = predictSpecial(game, ship, mode, aim)
  // The cell the fleet just shelled: big guns firing there again get spotting fire.
  const spotCell = mode === 'attack' && (ship?.class === 'battleship' || ship?.class === 'cruiser') ? game.lastGun : undefined

  const selectShip = (id: number) => {
    if (busy || finished) return
    const s = game.playerShips[id]
    if (!s || s.hp <= 0) return
    audio.play('select')
    setSelected(id)
    setMode(null)
    setTarget(null)
    const el = document.querySelector(`[data-plate="p${id}"]`)
    const c = fx.center(el)
    fx.sparkle(c.x, c.y, looks.player[id].color, 8, 60)
  }

  const chooseMode = (m: ActionType) => {
    audio.play('tap')
    setMode(m)
    setTarget(null)
    if (m === 'skill' && ship?.skillKind === 'sonar' && ship.pos) setTarget(ship.pos)
  }

  const onCell = (p: Pos) => {
    if (busy || finished) return
    if (targets.some((t) => samePos(t, p))) {
      if (samePos(target, p)) {
        void execute()
        return
      }
      audio.play('tap')
      setTarget(p)
      return
    }
    const own = game.playerShips.find((s) => s.hp > 0 && samePos(s.pos, p))
    if (own) selectShip(own.id)
  }

  // ---------------- choreography ----------------

  const impact = async (shot: Shot, mine: boolean) => {
    if (!mounted.current) return
    const pt = cellPt(shot.target)
    const victims = mine ? game.enemyShips : game.playerShips
    if ((shot.damage ?? 0) > 0) {
      const big = shot.sunk ? 1.9 : shot.crit ? 1.4 : 1
      fx.explosion(pt.x, pt.y, big, mine ? '#ffb347' : '#ff5a4e')
      audio.play(shot.sunk ? 'bigboom' : 'boom')
      if (shot.crit) {
        audio.play('crit')
        float(shot.target, `CRITICAL -${shot.damage}`, 'crit')
        fx.flash('#fff', 220, 0.55)
        await fx.hitstop(130)
      } else float(shot.target, `-${shot.damage}`, mine ? 'dmg' : 'hurt')
      fx.shake(shot.sunk ? 20 : shot.crit ? 14 : 9)
      fx.punch(shot.crit || shot.sunk ? 1.035 : 1.015)
      if (!mine) {
        fx.flash('#ff2a2a', 320, 0.35)
        audio.buzz(90)
      } else audio.buzz(30)
      setGame((g) => patchShot(g, shot, mine))
      if (shot.sunk) {
        await fx.hitstop(160)
        fx.explosion(pt.x + rnd(-20, 20), pt.y + rnd(-20, 20), 1.2)
        float(shot.target, mine ? '撃沈！' : '轟沈…', 'sunk')
      }
    } else if (shot.evaded) {
      fx.splash(pt.x, pt.y, 0.7)
      audio.play('evade')
      float(shot.target, 'EVADE', 'evade')
      if (mine) {
        const v = victims[shot.hitShipId!]
        if (v) float(shot.target, '敵影発見', 'found')
      }
    } else if (shot.splash) {
      fx.splash(pt.x, pt.y, 1.2)
      audio.play('splash')
      float(shot.target, mine ? '水しぶき！' : '至近弾', 'splash')
    } else {
      fx.splash(pt.x, pt.y, 0.55)
      audio.play('miss')
      float(shot.target, 'MISS', 'miss')
    }
  }

  const skyPoint = (to: { x: number; y: number }) => ({ x: to.x + rnd(-220, 220), y: -40 })

  // Water columns thrown up by battleship shells that missed.
  const columns = (r: Result) => {
    for (const p of r.columns ?? []) {
      const pt = cellPt(p)
      fx.splash(pt.x, pt.y, 1.9)
      fx.splash(pt.x + rnd(-10, 10), pt.y - 20, 1.3)
    }
    if (r.columns?.length) {
      audio.play('splash')
      float(r.columns[0], '水柱！', 'splash')
    }
  }

  const play = async (r: Result, after: GameView) => {
    if (!mounted.current) return
    const mine = r.side === 'player'
    const actorLook = (mine ? looks.player : looks.enemy)[r.shipId]
    const actor = (mine ? after.playerShips : after.enemyShips)[r.shipId]
    const c = mine ? card(actor?.key ?? '') : undefined
    const line = describe(r, after)
    const layer = layerRef.current
    const from = mine && actor ? cellPt(game.playerShips[r.shipId].pos ?? actor.pos!) : r.origin ? cellPt(r.origin) : undefined

    if (r.cancelled) {
      audio.play('miss')
      setLog((l) => [line, ...l])
      await show({ kind: 'notice', side: r.side, text: line.text }, 900)
      return
    }
    if (r.type === 'move') {
      audio.play(r.hidden ? 'dive' : 'move')
      if (r.hidden && r.side === 'player' && from) fx.bubbles(from.x, from.y, 10)
      setLog((l) => [line, ...l])
      setGame((g) => patchMeta(g, r))
      await show({ kind: 'notice', side: r.side, text: line.text }, mine ? 700 : 1100)
      return
    }

    // Cut-in.
    const torpedo = r.type === 'torpedo' || r.skill === 'spread'
    if (r.special) {
      audio.play('charge')
      fx.flash(mine ? '#fff6c0' : '#ff3050', 380, 0.7)
      fx.shake(10, 300)
      await show({ kind: 'special', special: r.special, look: actorLook, line: mine ? (c?.attack ?? '撃てっ！') : '……捉えた。', enemy: !mine }, 1500)
    } else if (r.type === 'ultimate') {
      audio.play('charge')
      fx.flash(mine ? '#fff6c0' : '#ff3050', 500, 0.6)
      if (mine) await show({ kind: 'ultimate', looks: after.playerShips.filter((s) => s.hp > 0).map((s) => looks.player[s.id]) }, 1700)
      else await show({ kind: 'banner', text: '敵艦隊 全艦斉射！！', sub: '総員、衝撃に備えよ！', tone: 'red' }, 1300)
    } else if (mine) {
      const title =
        r.type === 'skill'
          ? `${SKILL_INFO[r.skill!].icon} ${SKILL_INFO[r.skill!].name}！`
          : r.type === 'torpedo'
            ? `${TORPEDO_INFO.icon} 雷撃開始！`
            : '砲撃開始！'
      audio.play('whoosh')
      await show({ kind: 'attack', look: actorLook, line: c?.attack ?? '撃てっ！', title, skill: r.skill }, r.type === 'attack' ? 650 : 1000)
    } else {
      audio.play('alarm')
      const title = r.type === 'skill' ? `敵の${SKILL_INFO[r.skill!].name}！` : r.type === 'torpedo' ? '敵の雷撃！' : '敵艦の砲撃！'
      await show({ kind: 'enemy', look: actorLook, title }, 850)
    }
    if (!mounted.current) return

    const shots = r.shots ?? []
    const byCell = (p: Pos) => shots.find((s) => samePos(s.target, p))

    if (r.type === 'ultimate') {
      const cells = footprint(game.boardSize, 'ultimate', undefined, undefined, { row: 0, col: 0 }, r.target!)
      await Promise.all(
        cells.map(async (p, i) => {
          await wait(i * 70)
          const to = cellPt(p)
          audio.play('cannon')
          await flyShell(layer, skyPoint(to), to, ms(420), !mine)
          const s = byCell(p)
          if (s) await impact(s, mine)
          else fx.explosion(to.x, to.y, 0.6)
        }),
      )
      fx.flash('#fff', 400, 0.7)
      fx.shake(24, 600)
    } else if (r.skill === 'airstrike') {
      audio.play('airstrike')
      const to = cellPt(r.target!)
      await flyPlane(layer, to, ms(900))
      if (shots[0]) await impact(shots[0], mine)
    } else if (torpedo) {
      audio.play('torpedo')
      if (!mine && r.origin) float(r.origin, '雷跡！', 'found')
      await Promise.all(
        (r.paths ?? []).map(async (path) => {
          const pts = [from ?? cellPt(path[0]), ...path.map(cellPt)]
          await runTorpedo(layer, pts, ms(120), (i) => {
            const p = pts[i]
            fx.bubbles(p.x, p.y, 3)
          })
          const end = path[path.length - 1]
          const hit = end && byCell(end)
          if (hit) await impact(hit, mine)
          else if (end) {
            const pt = cellPt(end)
            fx.splash(pt.x, pt.y, 0.5)
            float(end, 'MISS', 'miss')
          }
        }),
      )
    } else if (r.skill === 'flare' || r.skill === 'sonar') {
      audio.play(r.skill)
      if (r.skill === 'flare') {
        const to = cellPt(r.target!)
        await flyShell(layer, from ?? skyPoint(to), to, ms(500), !mine)
        fx.rays(to.x, to.y, '#fff6c0', 12, 1)
        fx.flash('#fff6c0', 300, 0.35)
      } else if (from) {
        fx.ring(from.x, from.y, '#7ff', 520, 1.2)
        fx.ring(from.x, from.y, '#7ff', 360, 1)
      }
      setLit({ cells: r.scanned ?? [], kind: r.skill })
      await wait(700)
      for (const v of r.revealed ?? []) {
        if (mine) {
          float(v.pos, '発見！', 'found')
          const p = cellPt(v.pos)
          fx.sparkle(p.x, p.y, '#ff6b6b', 14, 90)
          audio.play('reveal')
        } else {
          float(v.pos, '発見された！', 'hurt')
        }
      }
      if (!r.revealed?.length) float(r.target!, '反応なし', 'miss')
      await wait(700)
      if (mounted.current) setLit(null)
    } else if (shots.length) {
      // Main guns and the barrage: every shell flies from the ship.
      if (from) fx.sparkle(from.x, from.y, '#ffd36b', 6, 50)
      await Promise.all(
        shots.map(async (s, i) => {
          await wait(i * 80)
          const to = cellPt(s.target)
          audio.play('cannon')
          await flyShell(layer, from ?? skyPoint(to), to, ms(i === 0 ? 520 : 480), !mine)
          await impact(s, mine)
        }),
      )
      columns(r)
    }
    if (!mounted.current) return
    setLog((l) => [line, ...l])
    setGame((g) => patchMeta(g, r))

    // Payoff beats.
    const hits = shots.filter((s) => (s.damage ?? 0) > 0).length
    if (mine && r.combo >= 2 && (hits || r.revealed?.length)) {
      setCombo({ n: r.combo, key: Date.now() })
      audio.play('combo', { pitch: r.combo })
    }
    const sunk = shots.filter((s) => s.sunk)
    if (sunk.length) {
      const names = sunk.map((s) => (mine ? after.enemyShips : after.playerShips)[s.hitShipId!]?.name).join('・')
      await wait(350)
      if (mine) {
        fx.confetti(40, ['#ffd24a', '#fff', '#ff9a3c'])
        await show({ kind: 'banner', text: '撃沈！！', sub: names, tone: 'gold' }, 1000)
        const left = after.enemyShips.filter((s) => s.hp > 0).length
        if (left === 1 && after.status !== 'finished') await show({ kind: 'banner', text: '敵艦 残り1隻！', sub: '一気に畳みかけろ！', tone: 'blue' }, 900)
      } else {
        await show({ kind: 'banner', text: '轟沈…', sub: names, tone: 'red' }, 1000)
      }
    }
    if (mine && r.gauge >= 100 && game.gauge < 100 && r.type !== 'ultimate') {
      audio.play('rare')
      fx.sparkle(640, 60, '#fff6b0', 30, 200)
      await show({ kind: 'banner', text: '決戦ゲージ MAX！', sub: '全艦斉射が使用可能！', tone: 'rainbow' }, 1000)
    }
  }

  const execute = async () => {
    if (!mode || !target || busy) return
    const shipId = mode === 'ultimate' ? flagship?.id : selected
    if (shipId === undefined || shipId === null) return
    setBusy(true)
    setHover(null)
    try {
      const res = await api.act(gameId, mode, shipId, target)
      setSelected(null)
      setMode(null)
      setTarget(null)
      for (const r of res.results) {
        if (!mounted.current) return
        await play(r, res.game)
      }
      if (!mounted.current) return
      setGame(res.game)
      if (res.game.status === 'finished') {
        onFinished()
        if (res.profile) setProfile(res.profile)
        setReward(res.reward)
        const win = res.game.winner === 'player'
        await wait(400)
        if (win) {
          audio.play('victory')
          fx.confetti(220, RAINBOW)
          fx.rays(640, 330, '#fff2a8', 18, 2)
          const sub = res.game.endReason === 'judgment' ? '判定勝利' : res.game.endReason === 'disarmed' ? '敵艦隊、撤退！' : '敵艦隊を撃滅！'
          await show({ kind: 'banner', text: 'VICTORY', sub, tone: 'rainbow' }, 2200)
        } else {
          audio.play('defeat')
          const sub = res.game.endReason === 'judgment' ? '判定敗北' : res.game.endReason === 'disarmed' ? '攻撃手段が尽き、戦略的撤退…' : '艦隊全滅…'
          await show({ kind: 'banner', text: 'DEFEAT', sub, tone: 'red' }, 2000)
        }
        if (mounted.current) setShowResult(true)
      } else {
        const left = res.game.maxTurns ? res.game.maxTurns - res.game.turn : undefined
        if (left !== undefined && left <= 3) audio.play('alarm')
        await show({ kind: 'turn', turn: res.game.turn + 1, left }, 750)
      }
    } catch (e) {
      audio.play('error')
      setCutin({ kind: 'notice', side: 'cpu', text: (e as Error).message })
      window.setTimeout(() => mounted.current && setCutin(null), 1500)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  // Keyboard: 1-4 ships, A/T/M/S/U modes, Enter fires, Esc cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || finished) return
      const n = Number(e.key)
      if (n >= 1 && n <= game.playerShips.length) selectShip(n - 1)
      else if (e.key === 'a' && ship && ship.attackTargets?.length) chooseMode('attack')
      else if (e.key === 't' && ship && ship.torpedoTargets?.length) chooseMode('torpedo')
      else if (e.key === 'm' && ship) chooseMode('move')
      else if (e.key === 's' && ship) chooseMode('skill')
      else if (e.key === 'u' && canUlt) chooseMode('ultimate')
      else if (e.key === 'Enter') void execute()
      else if (e.key === 'Escape') {
        setMode(null)
        setTarget(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const toggleSpeed = () => {
    const s = speed === 3 ? 1 : speed + 1
    audio.play('tap')
    setSpeed(s)
    try {
      localStorage.setItem(SPEED_KEY, String(s))
    } catch {
      /* storage unavailable */
    }
  }

  const span = game.boardSize >= 7 ? 440 : game.boardSize === 6 ? 432 : 410
  const lastLine = log[0]
  const inPreview = (p: Pos) => preview.some((q) => samePos(q, p))
  const litCell = (p: Pos) => lit?.cells.some((q) => samePos(q, p))
  const lead = ship ?? flagship
  const leadLook: Look | undefined = lead ? looks.player[lead.id] : undefined
  const skill = ship ? SKILL_INFO[ship.skillKind] : null

  return (
    <div className={`screen battle-screen ${stage.boss ? 'boss-stage' : ''}`}>
      <Backdrop scene="battle" dim={0.5} />

      {/* ---- header ---- */}
      <header className="battle-hud">
        <div className={`turn-plate ${turnsLeft !== undefined && turnsLeft <= 3 && !finished ? 'urgent' : ''}`}>
          <small>TURN</small>
          <b>{turn}</b>
          {game.maxTurns > 0 && <span>/{game.maxTurns}</span>}
        </div>
        <div className="hud-center">
          <GaugeBar value={game.gauge} />
          {game.combo >= 1 && !finished && (
            <span className={`combo-chip c${Math.min(game.combo, 5)}`} key={game.combo}>
              COMBO ×{game.combo}
            </span>
          )}
        </div>
        <div className="hud-tools">
          <span className="stage-chip">
            {stageLabel(stage)} {stage.name}
          </span>
          <span className={`weather-chip ${game.weather}`} title={WEATHER_INFO[game.weather ?? 'clear'].desc}>
            {WEATHER_INFO[game.weather ?? 'clear'].icon} {WEATHER_INFO[game.weather ?? 'clear'].name}
          </span>
          <button className={`chip-btn ${speed > 1 ? 'on' : ''}`} onClick={toggleSpeed} aria-label="演出速度">
            ▶▶ ×{speed}
          </button>
          <SoundToggle />
          {!finished && (
            <button className="chip-btn" onClick={() => go({ name: 'home' })} title="対局は保存され、母港から再開できます">
              撤退
            </button>
          )}
        </div>
      </header>

      {/* ---- player fleet ---- */}
      <aside className="fleet-col player">
        {game.playerShips.map((s) => (
          <ShipPlate key={s.id} ship={s} look={looks.player[s.id]} selected={selected === s.id} onClick={finished ? undefined : () => selectShip(s.id)} />
        ))}
        {leadLook && lead && (
          <div className="flagship-line">
            <b>{leadLook.name}</b>
            {finished
              ? '戦闘終了。お疲れさま！'
              : busy
                ? '交戦中……'
                : mode === 'ultimate'
                  ? '全艦、斉射用意！目標を！'
                  : ship
                    ? mode === 'attack'
                      ? '目標はどこ？'
                      : mode === 'torpedo'
                        ? '魚雷の針路は？'
                        : mode === 'move'
                        ? '針路を指示して。'
                        : mode === 'skill'
                          ? `${skill!.name}、いつでもいけるよ！`
                          : '指示をちょうだい。'
                    : '行動する艦を選んで。'}
          </div>
        )}
      </aside>

      {/* ---- board ---- */}
      <main className="battle-center">
        <div ref={boardRef} className={`board-wrap ${mode === 'ultimate' && !target ? 'ult-aim' : ''}`}>
          <Board
            size={game.boardSize}
            span={span}
            onCellClick={onCell}
            onCellHover={setHover}
            className={`battle-board ${mode ? `mode-${mode}` : ''}`}
            cellClass={(p) => {
              const cls: string[] = []
              // The barrage can aim anywhere: stop pulsing the whole sea once it is aimed.
              if (targets.some((t) => samePos(t, p)) && !(mode === 'ultimate' && target)) cls.push(`target-${mode === 'ultimate' ? 'skill' : mode}`)
              if (inPreview(p)) cls.push('aoe')
              if (samePos(target, p)) cls.push('chosen')
              if (litCell(p)) cls.push(`lit-${lit!.kind}`)
              const own = game.playerShips.find((s) => s.hp > 0 && samePos(s.pos, p))
              if (own) cls.push('has-ship')
              if (own && own.id === selected) cls.push('selected-ship')
              return cls.join(' ')
            }}
            renderCell={(p) => {
              const own = game.playerShips.find((s) => s.hp > 0 && samePos(s.pos, p))
              const enemy = game.enemyShips.find((s) => s.pos && samePos(s.pos, p) && (finished || s.spotted || s.hp <= 0))
              const marker = markers.get(`${p.row},${p.col}`)
              return (
                <>
                  {marker && !busy && <span className={`marker ${marker}`} />}
                  {spotCell && samePos(spotCell, p) && <span className="spot-sign">観測</span>}
                  {enemy && <ShipToken look={looks.enemy[enemy.id]} no={enemy.id + 1} sunk={enemy.hp <= 0} spotted={enemy.spotted && !finished} />}
                  {own && <ShipToken look={looks.player[own.id]} no={own.id + 1} />}
                </>
              )
            }}
            overlay={
              <>
                {floats.map((f) => (
                  <CellOverlay key={f.id} at={f.at} className="float-host">
                    <FloatText f={f} />
                  </CellOverlay>
                ))}
              </>
            }
          />
        </div>

        <div className="command-dock">
          {finished ? (
            !showResult && (
              <>
                <button className="pill-btn" onClick={() => setShowResult(true)}>
                  戦果報告
                </button>
                <button className="pill-btn ghost" onClick={() => go({ name: 'home' })}>
                  母港へ
                </button>
              </>
            )
          ) : (
            <>
              {ship ? (
                <>
                  {ship.maxAmmo > 0 && (
                    <button
                      className={`cmd-btn attack ${mode === 'attack' ? 'on' : ''}`}
                      disabled={busy || ship.ammo <= 0 || !ship.attackTargets?.length}
                      onClick={() => chooseMode('attack')}
                      title={CLASS_INFO[ship.class].role}
                    >
                      <b>砲撃</b>
                      <small>
                        射程{ship.gunRange} 残{ship.ammo}
                      </small>
                    </button>
                  )}
                  {ship.maxTorps > 0 && (
                    <button
                      className={`cmd-btn torp ${mode === 'torpedo' ? 'on' : ''}`}
                      disabled={busy || ship.torps <= 0}
                      onClick={() => chooseMode('torpedo')}
                      title={TORPEDO_INFO.desc}
                    >
                      <b>
                        {TORPEDO_INFO.icon}
                        {TORPEDO_INFO.name}
                      </b>
                      <small>後攻 残{ship.torps}</small>
                    </button>
                  )}
                  <button className={`cmd-btn move ${mode === 'move' ? 'on' : ''}`} disabled={busy || !ship.moveTargets?.length} onClick={() => chooseMode('move')}>
                    <b>移動</b>
                    <small>{ship.pinned ? '水柱で足止め中' : ship.class === 'submarine' ? `潜航 ${ship.moveRange}マス` : `縦横 ${ship.moveRange}マス`}</small>
                  </button>
                  <button
                    className={`cmd-btn skill ${mode === 'skill' ? 'on' : ''}`}
                    disabled={busy || ship.skill <= 0 || !ship.skillTargets?.length}
                    onClick={() => chooseMode('skill')}
                    title={skill!.desc}
                  >
                    <b>
                      {skill!.icon}
                      {skill!.name}
                    </b>
                    <small>
                      {skill!.short} 残{ship.skill}
                    </small>
                  </button>
                </>
              ) : (
                <p className="dock-hint">{busy ? '交戦中……' : '◀ 艦を選択（1〜4キー）'}</p>
              )}
              {canUlt && (
                <button className={`cmd-btn ultimate ${mode === 'ultimate' ? 'on' : ''}`} disabled={busy} onClick={() => chooseMode('ultimate')}>
                  <b>全艦斉射</b>
                  <small>3×3 一斉砲撃</small>
                </button>
              )}
              <button className={`cmd-btn go ${target ? 'ready' : ''} ${special ? 'special' : ''}`} disabled={busy || !target} onClick={() => void execute()}>
                {special && <em className="special-hint">{SPECIAL_INFO[special].name}！</em>}
                <b>{target ? (mode === 'move' ? '航行！' : mode === 'torpedo' ? '発射！' : '撃て！') : '決定'}</b>
                <small>{target ? `${posLabel(target)} ${mode === 'move' ? 'へ移動' : 'を目標'}` : mode ? 'マスを選択' : '行動を選択'}</small>
              </button>
            </>
          )}
        </div>
        {combo && (
          <div className={`combo-burst c${Math.min(combo.n, 5)}`} key={combo.key} onAnimationEnd={() => setCombo(null)}>
            <b>{combo.n}</b>
            <span>COMBO!</span>
          </div>
        )}
      </main>

      {/* ---- enemy fleet & log ---- */}
      <aside className="fleet-col enemy">
        <GaugeBar value={game.enemyGauge} enemy />
        <div className="aa-line" title="艦隊の対空合計。相手の航空攻撃の威力を下げる">
          <span>
            味方対空 <b>{game.aa}</b>
          </span>
          <span>
            敵対空 <b>{game.enemyAa}</b>
          </span>
        </div>
        {game.enemyShips.map((s) => (
          <ShipPlate key={s.id} ship={s} look={looks.enemy[s.id]} hot={s.spotted && s.hp > 0} />
        ))}
        <section className="battle-log">
          <h3>戦闘記録</h3>
          <ol>
            {log.map((l) => (
              <li key={l.key} className={`${l.tone} ${l === lastLine ? 'new' : ''}`}>
                <span className="log-turn">T{l.turn}</span>
                {l.text}
              </li>
            ))}
            {log.length === 0 && <li className="muted">まだ交戦記録はありません</li>}
          </ol>
        </section>
      </aside>

      <div className="projectiles" ref={layerRef} />

      {cutin && <CutinLayer cutin={cutin} onSkip={() => skip.current?.()} />}

      {showResult && reward && (
        <ResultOverlay gameId={gameId} game={game} stage={stage} reward={reward} onReward={setReward} onBoard={() => setShowResult(false)} go={go} />
      )}
    </div>
  )
}
