// Scatters the embers of each .embers layer with a fixed seed, so every render comes out the same.
let seed = 20261002
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
for (const layer of document.querySelectorAll('.embers')) {
  const [x, y, w, h] = layer.dataset.area.split(' ').map(Number)
  for (let n = 0; n < Number(layer.dataset.count); n++) {
    const size = 3 + rand() ** 3 * 16
    const dot = document.createElement('i')
    dot.style.cssText = `left:${x + rand() * w}px;top:${y + rand() * h}px;width:${size}px;height:${size}px;opacity:${0.35 + rand() * 0.65};filter:blur(${size > 12 ? 2 : 0}px)`
    layer.append(dot)
  }
}
