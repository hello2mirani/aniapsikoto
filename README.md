# aniapikoto

AniNeko & AniKoto **watch stream API**. Returns SUB / DUB / RAW servers with m3u8 links and subtitle files by MAL ID + episode number.

Deploy on **Vercel** or run locally with Express.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health + endpoint list |
| GET | `/api/anineko/mal/:malId/:episode` | AniNeko watch streams |
| GET | `/api/anikoto/mal/:malId/:episode` | AniKoto watch streams |

### Examples

```bash
# One Piece episode 1
curl "https://your-api.vercel.app/api/anineko/mal/21/1"
curl "https://your-api.vercel.app/api/anikoto/mal/21/1"
```

### Response

```json
{
  "success": true,
  "data": {
    "source": "anineko",
    "malId": 21,
    "episodeNumber": 1,
    "title": "One Piece",
    "slug": "one-piece",
    "anilistId": 21,
    "sub": [
      {
        "serverName": "HD-1",
        "category": "sub",
        "embedUrl": "https://...",
        "m3u8": "https://....m3u8",
        "type": "hls",
        "subtitles": [
          { "lang": "en", "label": "English", "url": "https://....vtt", "format": "vtt" }
        ]
      }
    ],
    "dub": [],
    "raw": []
  }
}
```

## Local run

```powershell
cd "D:\Dw\anime setup\anime-watch-api"
npm install
npm run dev
```

Server starts on **http://localhost:3002**

```powershell
curl http://localhost:3002/api/anineko/mal/21/1
```

## Vercel deploy

1. Push this repo to GitHub
2. Import in Vercel
3. No env vars required (optional: `NEKOSTREAM_MAPPER_URL`)

## Project structure

```
anime-watch-api/
├── api/index.js          # Vercel serverless entry
├── src/
│   ├── app.js            # Express app
│   ├── index.js          # Local dev server
│   ├── routes/
│   │   ├── anineko.js
│   │   └── anikoto.js
│   └── services/
│       ├── anineko.js
│       ├── anikoto.js
│       ├── embed-resolver.js
│       ├── http.js
│       ├── jikan.js
│       └── nekostream-mapper.js
├── package.json
└── vercel.json
```

## Use from hianime-next

Set in `.env.local`:

```env
WATCH_API_URL=https://your-anime-watch-api.vercel.app
```

Then call:

```
GET ${WATCH_API_URL}/api/anineko/mal/21/1
GET ${WATCH_API_URL}/api/anikoto/mal/21/1
```
