// Patch notes, newest first: the "Patch notes" button on the title screen opens them as an accordion.
// Add an entry here with every deploy (tests/patch-notes.test.ts checks the first one is the current version).
// The voice is a community manager's: short, plain, a little wry. Headings are <h3>, points are <ul><li>.

export interface PatchNote {
  /** The version as the title screen shows it, e.g. ".008". */
  v: string;
  /** A few words for the accordion's header. */
  title: string;
  date: string;
  html: string;
  /** Open when the modal opens (the latest patch with real news in it). */
  open?: boolean;
}

export const PATCH_NOTES: PatchNote[] = [
  {
    v: '.013', title: 'The war table', date: '10 Oct 2026', open: true,
    html: `<p>Skirmish has left the valley, Golds. It is fought on a map now, the kind a Praetor hangs in a war room. No rules changed, and the war for the valley is untouched.</p>
<ul>
<li><b>A drawn map, no tiles.</b> All four boards are inked on vellum: coasts, borders, mountains, woods and fens, with each region's name written across it and a heavy gold-threaded line where two regions meet.</li>
<li><b>Land wears its holder's colour.</b> Take a territory and it turns to yours.</li>
<li><b>Wooden pieces.</b> A cube is one army, a long block five, a pyramid ten. The coin beside each garrison is the count, and the pieces grow as you pull back so you can read it from across the room.</li>
<li><b>The register</b> under the map says what each region is worth. Dashed red lines are sea lanes.</li>
<li>Odds and armies placed this Draft show on a small plate over the garrison, as before.</li>
</ul>`,
  },
  {
    v: '.012', title: 'Skirmish', date: '10 Oct 2026',
    html: `<p>A second way to go to war, Golds: quick, classic, and nobody to hide behind. The war for the valley is unchanged.</p>
<ul>
<li><b>Skirmish.</b> Pick it under <b>Mode</b> when you set up a war, local or online. 2 to 4 Houses on a small board, and every territory starts in somebody's hands.</li>
<li><b>Four boards.</b> Earth (the classic 42), Mars, Westeros and the Four Nations. Dashed gold lines are sea lanes.</li>
<li><b>One way to win.</b> Take every enemy territory. No Keeps, no Standards, no neutrals, no alliances, no Olympus.</li>
<li><b>Your House still matters.</b> Primus, Passives and cards all work. The ones that spoke of Keeps or Standards say what they do on a board: read the card.</li>
<li><b>Ultimates for everyone.</b> If the host leaves them on, any House can cast from round 1: 3 cards, in your Draft, then 3 turns to recharge. No underdog rule.</li>
<li><b>How to play</b> inside a Skirmish has its own rules page.</li>
</ul>`,
  },
  {
    v: '.011', title: 'You asked, we listened', date: '9 Oct 2026',
    html: `<p>Five things from your first day in the new valley. No rules changed.</p>
<ul>
<li><b>Lands and regions read from far out.</b> Every land is outlined in ink, every region in a heavier line. Point at a land and it lights up white, with its whole region rimmed in gold.</li>
<li><b>Cards look like cards.</b> Your hand lies face up bottom-right, with each card's ability written on it. Point at one and it grows. Click it to lift it and play it, as before.</li>
<li><b>Sea lanes, redrawn.</b> Each is one clean arc round Olympus in its own colour, with the same mark (⚓ I, II, III) at both ends. Point at a port and its lane and its far shore light up.</li>
<li><b>One button: Roll!</b> No dice count, no choice between Roll and Blitz. Your army fights on until the land is yours or one soldier is left.</li>
<li><b>The sideboard starts open</b> on the Houses. ✕ or Esc closes it; <b>H</b>, <b>R</b>, <b>L</b> bring it back.</li>
</ul>`,
  },
  {
    v: '.010', title: 'The valley, rebuilt', date: '9 Oct 2026',
    html: `<p>No rules changed, Golds. Everything you look at did. Wars in progress carry on where they stopped.</p>
<h3>⛰ The valley</h3>
<ul>
<li>The board is a place now: real ground, a sea that moves, lakes with shores, a ridge of mountains, and Olympus hanging over it with rivers falling off its edge.</li>
<li>The gaps between quadrants are <b>rifts</b>: pits of rock you cannot cross. Land bridges are the low walls with watch fires.</li>
<li>From far out the map shows who holds what. Zoom in and it turns to terrain, with each House's colour along its borders.</li>
</ul>
<h3>⚔ Armies you can see</h3>
<ul>
<li>Every army is a <b>squad of soldiers</b> in its House's colours, with its number on a plate above it. The number never gets too small to read.</li>
<li>A Primus stands at their Keep. Mars's wears the wolf pelt. Nobody else gets one.</li>
<li>Squads march out to a fight. Across a sea lane a <b>ship</b> carries them, and stands off the shore if the first try fails.</li>
<li>Your odds sit on the targets themselves while you choose.</li>
</ul>
<h3>◈ A screen that gets out of the way</h3>
<ul>
<li>The map has the screen. Houses, Regions and the War Log are drawers on the right (<b>H</b>, <b>R</b>, <b>L</b>). The top-left buttons are three menus: ☰ Menu, 👁 Map views, 🤝 War council.</li>
<li>Your cards are a tray bottom-right. Tap one to lift it, then Play. No more playing a card by brushing it.</li>
<li>Hold <b>Alt</b> for territory and region names, or switch them on under Map views.</li>
<li><b>Phones:</b> bigger buttons, drawers as a sheet from the bottom, and you open on your own Keep. Hold a finger on a territory to read it.</li>
<li><b>Graphics</b> under Map views: Auto steps down by itself if your device struggles.</li>
</ul>
<h3>🔊 Sound</h3>
<ul>
<li>Water near the sea and the lakes, Olympus's falls, oars when a ship crosses, and ice in the Frostfangs.</li>
<li>The home screen finally has its rain.</li>
</ul>`,
  },
  {
    v: '.0092', title: 'Two small fixes', date: '8 Oct 2026',
    html: `<ul>
<li>Clicks on the map no longer die in the empty space around the bottom bar and the side panels. More of the valley is yours to poke.</li>
<li>Your land keeps its House colour while it glows, in the Draft and when it can attack. The old gold glow washed every House out to the same cream.</li>
</ul>`,
  },
  {
    v: '.0091', title: 'A new front gate', date: '7 Oct 2026',
    html: `<p>No rules changed, Golds. We just stopped making you stare at an empty valley before the killing starts.</p>
<h3>⛈ The home screen</h3>
<ul>
<li>You now stand under the gate of a Keep in a storm: lightning, rain, braziers, and seven torn House standards. The blood on the wall is not ours.</li>
<li>Tick <b>Sound</b> for the title music and thunder on every strike.</li>
<li><b>How to Play</b> lives bottom-left now, next to Sound and Patch notes.</li>
<li><b>Past Wars</b> and <b>The Codex</b> moved under <b>Advanced</b>. Still there, just out of the way.</li>
<li>Phones get the same screen in one column, with bigger buttons. Patch notes included.</li>
</ul>`,
  },
  {
    v: '.009', title: 'The House Draft', date: '7 Oct 2026',
    html: `<p>You asked, Golds. Houses get drafted, the Passage is back for those who miss the blood, and alliances can finally call it a day.</p>
<h3>♜ House Selection</h3>
<ul>
<li>The host picks <b>Draft</b> or <b>Random</b> in War Settings.</li>
<li><b>Draft:</b> a random order, one pick at a time, <b>30 seconds</b> each. Run out the clock and you get a random House.</li>
<li>Every House has a page to read first: its Ultimate vs a player and vs an alliance, pros and cons, and its top 3 Primus options.</li>
</ul>
<h3>♛ Primus Selection</h3>
<ul>
<li><b>Pick:</b> choose any Character of your House. No Passage.</li>
<li><b>Random (Passage):</b> two Characters of your House. One walks out with <b>+1</b> on their Passive. The other doesn't walk anywhere.</li>
</ul>
<h3>🏛 Ending the war</h3>
<ul>
<li>When an alliance drops its last enemy, it votes: <b>End Game</b> or <b>Siege Olympus</b>. Two Houses is enough.</li>
<li>The Siege needs more than half. A tie ends the war and everyone in the alliance wins.</li>
<li>No more hunting neutral Standards first.</li>
<li>Wars already running keep their old rules.</li>
</ul>`,
  },
  {
    v: '.0081', title: 'Patch notes', date: '4 Oct 2026',
    html: `<ul>
<li>Patch notes live here now. You found the button, so that works.</li>
</ul>`,
  },
  {
    v: '.008', title: 'House Ultimates', date: '4 Oct 2026',
    html: `<p>The biggest rules patch yet, Golds. Losing Houses get teeth, Keeps get Walls, and nobody dies in the Passage anymore. (We'll miss the screaming too.)</p>
<h3>⚡ House Ultimates</h3>
<ul>
<li>Every House has one. They open in <b>round 4</b>, for Houses in the <b>bottom half</b> of the standings.</li>
<li>Cast in your Draft for <b>3 cards</b>, 1 from your own House. Then it recharges for 3 of your turns.</li>
<li>Hit <b>one rival</b>, or a whole <b>public alliance</b> for less. You see a preview before you commit.</li>
<li>An Ultimate never knocks a House out. You still have to take the Standard yourself.</li>
<li>Don't want them? Switch them off in War Settings. They need 3 or more Houses.</li>
</ul>
<table class="ult-tbl">
<tr><td><b>Mars</b> · Where's Sevro?</td><td>Seize 3 territories. Half their armies die, the rest join you.</td></tr>
<tr><td><b>Jupiter</b> · Stormfall</td><td>Cut every stack in one quadrant to 5, and cap their next Draft at 5.</td></tr>
<tr><td><b>Pluto</b> · Rot</td><td>Their big stacks and their Drafts decay for three turns.</td></tr>
<tr><td><b>Minerva</b> · Blackout</td><td>Skip their next turn and read their hand.</td></tr>
<tr><td><b>Ceres</b> · The Tithe</td><td>Take half their next Draft, and a quarter of the one after.</td></tr>
<tr><td><b>Apollo</b> · Solar Flare</td><td>−1 on their highest defense die against you and your allies.</td></tr>
<tr><td><b>Diana</b> · The Wild Hunt</td><td>Their Standard loses its honor guard, and you strike 2 spaces away.</td></tr>
</table>
<h3>♜ Keeps</h3>
<ul>
<li><b>Walls:</b> whoever defends a Keep adds +1 to their highest defense die.</li>
<li>A neutral Keep takes about <b>20 armies</b> now, and it no longer hands you the rest of its House's land.</li>
</ul>
<h3>♛ Your House, your Primus</h3>
<ul>
<li><b>Pick your House</b> before the war, or stay on Random. The host can set anyone's.</li>
<li><b>Choose your Primus</b> replaces the Passage: any Character of your own House, with the Passive printed on the card.</li>
</ul>
<h3>Also</h3>
<ul>
<li>Leave an alliance with Ultimates on and you are <b>Locked out</b> of alliances for 2 of your turns.</li>
<li>The AI casts Ultimates, and no longer stalls on a Rally that quietly filled up.</li>
<li>🎓 The Proctor's Guide teaches all of it, and <b>How to Play</b> has the full rules.</li>
<li>Wars already running keep going: new Keep rules, no Ultimates.</li>
</ul>`,
  },
];
