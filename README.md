# pretext.video

Turn your webcam into living typography. Pure browser, no server.

**[Try it live](https://pretext.video)**

## Modes

- **Text Face** — text fills your body silhouette, colored by video pixels
- **Cutout in Text** — your real image cuts through a wall of text, with text reflowing around you

## How it works

- [Pretext](https://github.com/chenglou/pretext) for text measurement and layout — `layoutNextLine()` enables per-line variable-width reflow around the person shape
- [MediaPipe](https://developers.google.com/mediapipe) Image Segmenter for real-time person segmentation
- [mediabunny](https://github.com/nickslevine/mediabunny) for WebCodecs MP4 recording
- Canvas 2D for compositing — pixel sampling, mask blending, character-level rendering

Everything runs in the browser. No backend, no uploads.

## Development

```
npm install
npm run dev
```

## License

MIT
