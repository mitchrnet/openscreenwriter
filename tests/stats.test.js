/**
 * stats.test.js — Unit tests for script statistics extraction
 */

import { describe, it, expect } from 'vitest';
import { screenplaySchema as schema } from '../renderer/editor/schema.js';
import { fountainToDoc } from '../renderer/editor/serializer.js';
import { extractStats } from '../renderer/editor/stats.js';

function makeDoc(text) {
  return fountainToDoc(text, schema).doc;
}

describe('extractStats', () => {
  it('counts scenes correctly', () => {
    const doc = makeDoc([
      'INT. KITCHEN - DAY',
      '',
      'Action here.',
      '',
      'EXT. GARDEN - NIGHT',
      '',
      'More action.',
    ].join('\n'));
    const s = extractStats(doc);
    expect(s.sceneCount).toBe(2);
  });

  it('counts INT vs EXT', () => {
    const doc = makeDoc([
      'INT. KITCHEN - DAY',
      '',
      'Action.',
      '',
      'INT. OFFICE - DAY',
      '',
      'More action.',
      '',
      'EXT. STREET - NIGHT',
      '',
      'Outside.',
    ].join('\n'));
    const s = extractStats(doc);
    expect(s.intCount).toBe(2);
    expect(s.extCount).toBe(1);
  });

  it('counts DAY vs NIGHT', () => {
    const doc = makeDoc([
      'INT. KITCHEN - DAY',
      '',
      'Action.',
      '',
      'EXT. STREET - NIGHT',
      '',
      'Outside.',
      '',
      'INT. OFFICE - MORNING',
      '',
      'Work.',
    ].join('\n'));
    const s = extractStats(doc);
    expect(s.dayCount).toBe(2); // DAY + MORNING both match DAY_RE
    expect(s.nightCount).toBe(1);
  });

  it('counts words across all block types', () => {
    const doc = makeDoc([
      'INT. ROOM - DAY',
      '',
      'She walks in.',
      '',
      'ALICE',
      'Hello world.',
    ].join('\n'));
    const s = extractStats(doc);
    // "INT. ROOM - DAY" = 4, "She walks in." = 3, "ALICE" counted as 0 (character), "Hello world." = 2
    // scene heading "INT. ROOM - DAY" counts as words too
    expect(s.wordCount).toBeGreaterThan(0);
  });

  it('counts dialogue lines per character', () => {
    const doc = makeDoc([
      'INT. ROOM - DAY',
      '',
      'ALICE',
      'Line one.',
      '',
      'BOB',
      'Line two.',
      '',
      'ALICE',
      'Line three.',
    ].join('\n'));
    const s = extractStats(doc);
    const alice = s.topChars.find(c => c.name === 'ALICE');
    const bob   = s.topChars.find(c => c.name === 'BOB');
    expect(alice).toBeDefined();
    expect(alice.lineCount).toBe(2);
    expect(bob).toBeDefined();
    expect(bob.lineCount).toBe(1);
  });

  it('returns topChars sorted by lineCount descending', () => {
    const doc = makeDoc([
      'INT. ROOM - DAY',
      '',
      'BOB',
      'One line.',
      '',
      'ALICE',
      'Line A.',
      '',
      'ALICE',
      'Line B.',
      '',
      'ALICE',
      'Line C.',
    ].join('\n'));
    const s = extractStats(doc);
    expect(s.topChars[0].name).toBe('ALICE');
    expect(s.topChars[0].lineCount).toBe(3);
  });

  it('counts dialogue lines inside dual_dialogue', () => {
    const doc = makeDoc([
      'ALICE',
      'Left.',
      '',
      'BOB ^',
      'Right.',
    ].join('\n'));
    const s = extractStats(doc);
    expect(s.dialogueLineCount).toBe(2);
    const alice = s.topChars.find(c => c.name === 'ALICE');
    const bob   = s.topChars.find(c => c.name === 'BOB');
    expect(alice?.lineCount).toBe(1);
    expect(bob?.lineCount).toBe(1);
  });
});
