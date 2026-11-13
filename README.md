# Dino Duel

A fast 1 vs 1 platform fighter with mini dinosaurs. Runs in any browser on PC or phone; no build step, no server.

- One hit kills. First to 10 round wins takes the match; a tie scores nothing.
- 30 maps from small to large, random spawn points, a 3-2-1-GO countdown.
- Both dinos start unarmed. 50 weapons drop onto platforms, from a twig up to the Dartling Gun.
- Fall off the map and you're out. After 30 seconds, razors close in from the top and bottom.
- Play a bot (Easy, Normal, Hard, Impossible) or a friend online with a room code.

## Play

Open `index.html`, or host the folder on any static host. Online play needs the page served over
http(s); it connects the two players directly using [PeerJS](https://peerjs.com) (bundled in `js/vendor`, MIT)
and its free public broker. The host's browser runs the match.

Keyboard: A/D or arrows to move, W / Up / Space to jump (twice for a double jump), J / F / Enter to attack.
Phone: hold it sideways; move pad on the left, attack and jump on the right.

## Code

| File | Purpose |
| --- | --- |
| `js/data.js` | Tuning constants, the 50 weapons, the 30 maps, bot difficulty settings |
| `js/sim.js` | Physics, weapons, round flow, sudden death, bot AI, network snapshots |
| `js/client.js` | Drawing and animation, keyboard and touch input, menus |
| `js/net.js` | Online play |
