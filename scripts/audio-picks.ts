// What the game sounds like: which clips from the local library (and, only to fill its gaps, ElevenLabs)
// go into each in-game sound. `node scripts/audio-build.ts` turns this into public/audio + src/ui/audio-manifest.ts.
//
// Paths are relative to the sorted library (institute-conquest-audio-sorted on the Desktop; override with AUDIO_LIB).
// Every sound works without ElevenLabs: groups only it can fill have a local or synthesized stand-in in src/ui/sound.ts.

export interface ElevenSpec {
  /** What to ask for. Describe the sound, not a scene: no music, no voices unless wanted. */
  prompt: string;
  /** Seconds (0.5–30). */
  duration: number;
  /** How many takes to generate; the game picks one at random each time. */
  takes: number;
  /** A seamless loop (eleven_text_to_sound_v2 only). */
  loop?: boolean;
  /** 0–1: higher sticks closer to the prompt, lower lets the model improvise. */
  influence?: number;
}

export interface SfxGroup {
  local?: string[];
  eleven?: ElevenSpec;
  /** Keep the clip's start as is (for loops and swells): don't trim leading silence. */
  keepHead?: boolean;
}

export const SFX: Record<string, SfxGroup> = {
  // --- interface -------------------------------------------------------------
  click: { local: ['menu/click/click__menu-01.wav'] },
  confirm: { local: ['menu/confirm/ding__menu-04.wav', 'menu/confirm/confirm__menu-02.wav'] },
  /** A short musical cue: a card played, a region taken. */
  cue: { local: ['menu/stinger/game_cue__game-02.wav'] },
  /** Betrayal, a siege that fails. */
  dread: { local: ['menu/stinger/music_stinger__genamb-54.wav'] },

  // --- battle ----------------------------------------------------------------
  /** Armies set down in the Draft. */
  thud: { local: ['battle/impact_hit/impact__weapon-61.wav', 'battle/impact_hit/impact__weapon-62.wav', 'battle/impact_hit/impact__weapon-52.wav', 'battle/impact_hit/impact__weapon-58.wav'] },
  grunt: {
    local: [47, 50, 68, 70, 71, 76, 79, 80, 83, 87, 90, 91].map((n) => `battle/pain_grunt/grunt__pain-${n}.wav`),
  },
  scream: { local: [10, 11, 14, 55, 82, 85, 98].map((n) => `battle/death_scream/scream__pain-${n}.wav`) },
  /** No gunpowder in the Institute: these are boulders, falling walls and fire. */
  boom: {
    local: ['genamb-33', 'indamb-14', 'indamb-16', 'indamb-56', 'indamb-58', 'outamb-43', 'weapon-13', 'weapon-51'].map((id) => `battle/explosion_fire/blast__${id}.wav`),
  },
  whoosh: { local: ['battle/swing_whoosh/whoosh__weapon-22.wav', 'battle/swing_whoosh/whoosh__weapon-26.wav', 'battle/swing_whoosh/whoosh__weapon-75.wav'] },
  drum: { local: ['movement/drum_horn/war_drum__indamb-30.wav'] },
  thunder: { local: ['ambience/weather/thunder__outamb-42.wav'] },
  rumble: { local: ['ambience/rumble/rumble__indamb-19.wav', 'ambience/rumble/rumble__indamb-42.wav'] },
  /** The one crowd clip in the library; stands in for `warcry` until ElevenLabs fills it. */
  chaos: { local: ['battle/war_cry_crowd/battle_chaos__weapon-70.wav'] },

  // --- the valley (occasional, quiet) ------------------------------------------
  nature: {
    local: ['owl__outamb-23', 'wolf_howl__outamb-24', 'birds__outamb-21', 'birds__outamb-02', 'frogs_insects__outamb-29'].map((id) => `ambience/nature/${id}.wav`),
  },

  // --- gaps only ElevenLabs fills (see the README's "Gaps for the next wave") ---------------
  clash: { eleven: { prompt: 'Two heavy steel longswords clashing hard, one sharp metallic impact with a short ring, close up, dry, no music', duration: 1, takes: 3, influence: 0.5 } },
  dice: { eleven: { prompt: 'Five bone dice shaken briefly in a leather cup, thrown onto a wooden table, tumbling and settling', duration: 1.2, takes: 2, influence: 0.5 } },
  horn: { eleven: { prompt: 'A single long blast of an ancient bronze war horn echoing across a mountain valley, no music', duration: 3, takes: 1, influence: 0.5 } },
  warcry: { eleven: { prompt: 'A crowd of fifty young soldiers roaring a battle cry as they charge, ancient warfare, outdoors, no music, no words', duration: 2.5, takes: 2, influence: 0.45 } },
  /** The men answering the turn horn: one short shout, not a charge. */
  shout: { eleven: { prompt: 'A band of twenty soldiers giving one short sharp unified war shout together, a single "HAH!", outdoors, slight echo, no music', duration: 1.2, takes: 2, influence: 0.5 } },
  march: { eleven: { prompt: 'A column of soldiers marching on packed dirt, leather boots, light armor and scabbards rattling, outdoors, no music', duration: 2, takes: 1, influence: 0.45 } },
  card: { eleven: { prompt: 'A stiff parchment card flicked and slapped down onto a wooden table', duration: 0.6, takes: 2, influence: 0.5 } },
  wind: { eleven: { prompt: 'Cold steady wind across an empty highland valley, soft gusts, no birds, no music', duration: 20, takes: 1, loop: true, influence: 0.4 }, keepHead: true },
};

export type Mood = 'title' | 'calm' | 'tense' | 'battle' | 'victory' | 'defeat';

/**
 * The soundtrack: A.T.W. - The Wrath of God (the user's own library). Picked from the sorter's mood folders
 * by confidence, leaving out the electronic/dubstep-heavy tracks. Battle tracks with a strong build start at
 * their ramp, so the climax lands as the fighting starts.
 */
export const MUSIC: Record<Mood, string[]> = {
  title: ['victory_or_epic/victory_or_epic__atw-292.mp3', 'victory_or_epic/victory_or_epic__atw-126.mp3'],
  calm: ['somber/somber__atw-030.mp3', 'somber/somber__atw-290.mp3', 'somber/somber__atw-115.mp3', 'calm/calm__atw-158.mp3', 'somber/somber__atw-223.mp3'],
  tense: ['tense/tense__atw-088.mp3', 'tense/tense__atw-122.mp3', 'tense/tense__atw-102.mp3', 'tense/tense__atw-070.mp3', 'tense/tense__atw-097.mp3'],
  battle: ['battle/battle__atw-061.mp3', 'battle/battle__atw-151.mp3', 'battle/battle__atw-099.mp3', 'battle/battle__atw-037.mp3', 'battle/battle__atw-015.mp3', 'battle/battle__atw-121.mp3', 'battle/battle__atw-073.mp3'],
  victory: ['victory_or_epic/victory_or_epic__atw-052.mp3', 'victory_or_epic/victory_or_epic__atw-124.mp3', 'victory_or_epic/victory_or_epic__atw-101.mp3'],
  defeat: ['somber/somber__atw-188.mp3', 'somber/somber__atw-221.mp3'],
};
