/**
 * character-list.test.js — Unit tests for extractCharacters()
 *
 * extractCharacters is a pure function over a ProseMirror doc — no DOM, no browser.
 */

import { describe, it, expect } from 'vitest';
import { screenplaySchema as schema } from '../renderer/editor/schema.js';
import { extractCharacters } from '../renderer/editor/character-list.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a doc from [type, text?] pairs. */
function buildDoc(...blocks) {
  const nodes = blocks.map(([type, text]) => {
    if (type === 'page_break') return schema.node('page_break');
    const children = text ? [schema.text(text)] : [];
    return schema.node(type, null, children);
  });
  return schema.node('doc', null, nodes);
}

// ─── extractCharacters ────────────────────────────────────────────────────────

describe('extractCharacters', () => {

  it('returns empty array for doc with no characters', () => {
    const doc = buildDoc(['action', 'Some action.']);
    expect(extractCharacters(doc)).toEqual([]);
  });

  it('returns empty array for empty doc', () => {
    const doc = buildDoc(['action', '']);
    expect(extractCharacters(doc)).toEqual([]);
  });

  it('extracts a single character with one dialogue line', () => {
    const doc = buildDoc(
      ['character', 'JOHN'],
      ['dialogue', 'Hello there.'],
    );
    const result = extractCharacters(doc);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('JOHN');
    expect(result[0].lineCount).toBe(1);
    expect(result[0].sceneCount).toBe(1); // scene 0 (no heading)
  });

  it('normalises character name to uppercase', () => {
    const doc = buildDoc(['character', 'john'], ['dialogue', 'Hi.']);
    const result = extractCharacters(doc);
    expect(result[0].name).toBe('JOHN');
  });

  it('counts multiple dialogue lines for one character', () => {
    const doc = buildDoc(
      ['character', 'ALICE'],
      ['dialogue', 'Line one.'],
      ['dialogue', 'Line two.'],
      ['dialogue', 'Line three.'],
    );
    const result = extractCharacters(doc);
    expect(result[0].lineCount).toBe(3);
  });

  it('counts dialogue through a parenthetical', () => {
    const doc = buildDoc(
      ['character', 'BOB'],
      ['parenthetical', '(quietly)'],
      ['dialogue', 'Come here.'],
    );
    const result = extractCharacters(doc);
    expect(result[0].lineCount).toBe(1);
  });

  it('two characters in the same scene each counted once', () => {
    const doc = buildDoc(
      ['scene_heading', 'INT. OFFICE - DAY'],
      ['character', 'ALICE'],
      ['dialogue', 'Hello.'],
      ['character', 'BOB'],
      ['dialogue', 'Hi.'],
    );
    const result = extractCharacters(doc);
    expect(result).toHaveLength(2);
    expect(result.find(c => c.name === 'ALICE').sceneCount).toBe(1);
    expect(result.find(c => c.name === 'BOB').sceneCount).toBe(1);
  });

  it('character appearing in multiple scenes has correct sceneCount', () => {
    const doc = buildDoc(
      ['scene_heading', 'INT. ROOM A - DAY'],
      ['character', 'ALICE'],
      ['dialogue', 'Line 1.'],
      ['scene_heading', 'INT. ROOM B - NIGHT'],
      ['character', 'ALICE'],
      ['dialogue', 'Line 2.'],
    );
    const result = extractCharacters(doc);
    expect(result).toHaveLength(1);
    expect(result[0].sceneCount).toBe(2);
    expect(result[0].lineCount).toBe(2);
  });

  it('character appearing twice in the same scene counts as one scene', () => {
    const doc = buildDoc(
      ['scene_heading', 'INT. ROOM - DAY'],
      ['character', 'ALICE'],
      ['dialogue', 'First.'],
      ['action', 'Some action.'],
      ['character', 'ALICE'],
      ['dialogue', 'Second.'],
    );
    const result = extractCharacters(doc);
    expect(result[0].sceneCount).toBe(1); // same scene
    expect(result[0].lineCount).toBe(2);
  });

  it('multiple characters across multiple scenes', () => {
    const doc = buildDoc(
      ['scene_heading', 'INT. ROOM A - DAY'],
      ['character', 'ALICE'],
      ['dialogue', 'Hi.'],
      ['character', 'BOB'],
      ['dialogue', 'Hey.'],
      ['scene_heading', 'INT. ROOM B - NIGHT'],
      ['character', 'ALICE'],
      ['dialogue', 'Goodbye.'],
    );
    const result = extractCharacters(doc);
    const alice = result.find(c => c.name === 'ALICE');
    const bob   = result.find(c => c.name === 'BOB');
    expect(alice.sceneCount).toBe(2);
    expect(alice.lineCount).toBe(2);
    expect(bob.sceneCount).toBe(1);
    expect(bob.lineCount).toBe(1);
  });

  it('returns characters sorted by first appearance', () => {
    const doc = buildDoc(
      ['character', 'CHARLIE'],
      ['dialogue', 'First.'],
      ['character', 'ALICE'],
      ['dialogue', 'Second.'],
      ['character', 'BOB'],
      ['dialogue', 'Third.'],
    );
    const result = extractCharacters(doc);
    expect(result.map(c => c.name)).toEqual(['CHARLIE', 'ALICE', 'BOB']);
  });

  it('action between characters clears dialogue attribution', () => {
    const doc = buildDoc(
      ['character', 'ALICE'],
      ['dialogue', 'Line 1.'],
      ['action', 'She leaves.'],
      // dialogue here should NOT be attributed to ALICE
      ['dialogue', 'Orphan line.'],
    );
    const result = extractCharacters(doc);
    expect(result[0].lineCount).toBe(1); // only the first dialogue
  });

  it('scene_heading clears dialogue attribution', () => {
    const doc = buildDoc(
      ['character', 'ALICE'],
      ['dialogue', 'Goodbye.'],
      ['scene_heading', 'INT. NEW SCENE - DAY'],
      ['dialogue', 'Should not count.'],
    );
    const result = extractCharacters(doc);
    expect(result[0].lineCount).toBe(1);
  });

  it('character with no following dialogue has lineCount 0', () => {
    const doc = buildDoc(
      ['character', 'ALICE'],
      ['action', 'She says nothing.'],
    );
    const result = extractCharacters(doc);
    expect(result[0].lineCount).toBe(0);
    expect(result[0].sceneCount).toBe(1);
  });

  it('empty character node text is skipped', () => {
    const doc = buildDoc(
      ['character', ''],
      ['dialogue', 'Orphan.'],
    );
    expect(extractCharacters(doc)).toHaveLength(0);
  });

  it('firstPos is set to the position of the first character node', () => {
    const doc = buildDoc(
      ['action', 'Intro.'],
      ['character', 'ALICE'],
      ['dialogue', 'Hi.'],
    );
    const result = extractCharacters(doc);
    // firstPos should be > 0 (there's an action block before it)
    expect(result[0].firstPos).toBeGreaterThan(0);
  });

  it('page_break does not affect character attribution', () => {
    const doc = buildDoc(
      ['character', 'ALICE'],
      ['page_break'],
      ['dialogue', 'After break.'],
    );
    // page_break is not dialogue/parenthetical — clears attribution
    const result = extractCharacters(doc);
    expect(result[0].lineCount).toBe(0);
  });

});
