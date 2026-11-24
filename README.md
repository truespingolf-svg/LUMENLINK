# LUMENLINK — Wireless Screen Lighting Console

LUMENLINK turns smartphones, tablets, and laptops into individually addressable, real-time synchronised lighting fixtures controlled from a professional desktop lighting console.

## Architecture
- **Host Server (`server.ts`, `src/server/showStore.ts`)**: Node.js + Express + WebSocket (`ws`) server on port `3000` handling authoritative show state, clock synchronization, device heartbeats/reconnection, media uploads/distribution, and JSON show persistence (`./data/store.json`).
- **Deterministic Effect Engine (`src/engine/effects.ts`, `src/engine/colors.ts`)**: Computes colour transitions, spatial pixel-mapped waves, bouncing flashes, multi-layer blending, and cue/timeline outputs at 60fps across all clients.
- **Host Console (`/`)**: grandMA3 / MagicQ / Avolites-inspired dark charcoal console with Live Colour Programmer, Effect Generator, Fixture Patch & Drag-and-Drop Pixel Mapper, Cue & Multi-Track Timeline Editor, Media Projection, QR Poster Studio (PNG/SVG/Print/PDF), and Show Manager.
- **Audience Device Interface (`/join`, `/join/:showId`)**: Zero-install browser client with custom welcome screen, live edge-to-edge lighting output, synchronised media/video, portrait/landscape adaptation, Fullscreen & Wake Lock mode, and automatic WebSocket reconnection.

## Installation & Running Locally
```bash
npm install
npm run dev
```
Open `http://localhost:3000` for the Host Console, and `http://localhost:3000/join` on audience devices.

## Windows Setup (Local LAN / Internet-Free Hotspot Mode)
1. Install Node.js 20 LTS or newer for Windows.
2. Run `npm install` and `npm run dev` (or `npm run build && npm start` for production).
3. Allow TCP port `3000` in **Windows Defender Firewall** (Private/Local network).
4. Connect the host laptop and audience phones to the same local Wi-Fi router, or turn on **Windows Mobile Hotspot** on the host laptop.
5. In the Host Console, open **Join & Poster**, select **Mode A: Local LAN / Hotspot**, verify the host's LAN IPv4 address (`http://192.168.x.x:3000/join/...`), and print or display the QR poster.
   *Note: Scanning a QR code opens the URL in the phone's browser; devices must be connected to the same Wi-Fi/hotspot (Mode A) or an internet-accessible server (Mode B) to receive live WebSocket commands.*

## Production Deployment (Mode B: Remote Network)
```bash
npm run build
NODE_ENV=production npm start
```
Optionally set `HOST_PASSCODE` in environment variables to require passcode authentication on the Host Console.

## Testing
Run unit tests for the effect engine, show serializer, and server state store:
```bash
npx --yes tsx --test src/engine/effects.test.ts src/engine/shows.test.ts src/server/showStore.test.ts
```
