# CW Synth

CW Synth — a 6-operator FM synthesiser for the browser. Built with Vite + React + TypeScript and the Web Audio API.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
Output goes to `dist/` — deploy to any static host (Netlify, Vercel, GitHub Pages).

## Patches (.cwsyn)

Patches are plain JSON files with a `.cwsyn` extension. Export from the Presets tab and share freely.

## Keyboard shortcuts

| Key row | Notes |
|---------|-------|
| `z s x d c v g b h n j m` | C3 – B3 |
| `q 2 w 3 e r 5 t 6 y 7 u` | C4 – B4 |
| `i 9 o 0 p` | C5 – E5 |

MIDI input is auto-detected if a device is connected.
