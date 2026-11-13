# GridWars

A pixel-art village-vs-village strategy game that runs entirely in the browser. No build step, no server.

- 500×500 world with nine biomes (plains, forest, desert, tundra, swamp, hills, peaks, shallows, deep water), each with its own movement speed, farm yield and resources.
- Up to 4 villages. Each starts with a Town Hall, 2 Worker's Homes, a Storage and a Shop.
- Point workers at trees, rocks, ore and berries; spend the haul in the Shop on farms, pens, homes, barracks, stables, walls, towers, docks and more.
- Travel by foot, road, bridge, horse or boat. The peak of technology is steel weapons and armor.
- Single player against 1–3 computer villages, or online multiplayer with a room code.

## Play

Open `index.html` in a browser, or host the folder on any static host (e.g. GitHub Pages).
Multiplayer needs the page served over http(s) and an internet connection; it uses
[PeerJS](https://peerjs.com) (bundled in `js/vendor`, MIT) and its free public broker to connect players directly.
The host's browser runs the match, so the game ends for everyone if the host leaves.

Press **?** in game for controls and the biome table.

## Code

| File | Purpose |
| --- | --- |
| `js/data.js` | Biomes, buildings, units, costs |
| `js/map.js` | Seeded world generation |
| `js/sim.js` | Game rules, pathfinding, computer players, snapshots |
| `js/sprites.js` | Procedurally drawn pixel art |
| `js/net.js` | Peer-to-peer multiplayer |
| `js/client.js` | Rendering, input, HUD, menus |
