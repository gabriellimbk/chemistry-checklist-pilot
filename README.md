# Summary Map Pilot

Static pilot build of the chemistry summary map app.

## How to preview locally

Open `index.html` through a local static server, for example:

```powershell
python -m http.server 8000
```

Then visit:

```text
http://127.0.0.1:8000/
```

## Hosting

This folder is ready to be uploaded as the root of a static site, such as GitHub Pages or Vercel.

No backend or audio generation is required. Mastery progress and highlights are stored in the user's browser `localStorage`.

## Notes

- Do not upload `.env` or API keys.
- Topic progress is device/browser-specific.
- The app entry point is `index.html`.
