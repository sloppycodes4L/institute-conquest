// Patch notes, newest first: the "Patch notes" button on the title screen (desktop widths) opens them as an accordion.
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
    v: '.0081', title: 'Patch notes', date: '4 Oct 2026',
    html: `<ul>
<li>Patch notes live here now. You found the button, so that works.</li>
</ul>`,
  },
  {
    v: '.008', title: 'House Ultimates', date: '4 Oct 2026', open: true,
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
