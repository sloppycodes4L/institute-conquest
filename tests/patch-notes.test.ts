// The patch notes behind the title screen's "Patch notes" button.
import { describe, expect, it } from 'vitest';
import { PATCH_NOTES } from '../src/ui/patch-notes.ts';
import { VERSION } from '../src/version.ts';

describe('patch notes', () => {
  it('start with the version that is shipping, newest first, each with a title, a date and notes', () => {
    expect(PATCH_NOTES[0].v).toBe(VERSION);
    const n = PATCH_NOTES.map((p) => +p.v);
    expect([...n].sort((a, b) => b - a)).toEqual(n);
    expect(new Set(PATCH_NOTES.map((p) => p.v)).size).toBe(PATCH_NOTES.length);
    for (const p of PATCH_NOTES) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.date).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
      expect(p.html).toContain('<li>');
    }
    // One fold is open when the modal opens.
    expect(PATCH_NOTES.filter((p) => p.open).length).toBe(1);
  });
});
