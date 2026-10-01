// Renders modelled explosions (blast.ts) off the main thread: a take of a magazine
// going up costs a few hundred milliseconds of maths, which would stall the battle.
import { blast, type BlastOpts } from './blast'

const scope = self as unknown as { postMessage(m: unknown, transfer: Transferable[]): void }

self.onmessage = (e: MessageEvent<{ id: number; o: BlastOpts; rate: number }>) => {
  const { id, o, rate } = e.data
  const [l, r] = blast(o, rate)
  scope.postMessage({ id, l, r }, [l.buffer, r.buffer])
}
