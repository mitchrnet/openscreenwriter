/**
 * fountain.test.js — Unit tests for the Fountain markup parser
 *
 * Tests parseFountain() and processInlineMarkup() from renderer/fountain.js.
 * These are pure functions with no browser dependencies.
 */

import { describe, it, expect } from 'vitest';
import { parseFountain, processInlineMarkup } from '../renderer/fountain.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return only the type fields from a token array, filtering out 'empty'. */
function types(tokens) {
  return tokens.filter(t => t.type !== 'empty').map(t => t.type);
}

/** Find all tokens of a given type. */
function ofType(tokens, type) {
  return tokens.filter(t => t.type === type);
}

// ─── parseFountain ────────────────────────────────────────────────────────────

describe('parseFountain', () => {

  // ── Empty / whitespace input ─────────────────────────────────────────────

  it('returns [] for empty string', () => {
    expect(parseFountain('')).toEqual([]);
  });

  it('returns [] for whitespace-only string', () => {
    expect(parseFountain('   \n\n  ')).toEqual([]);
  });

  // ── Action (default) ─────────────────────────────────────────────────────

  it('parses a plain line as action', () => {
    const tokens = parseFountain('John walks into the room.');
    expect(types(tokens)).toEqual(['action']);
    expect(tokens[0].text).toBe('John walks into the room.');
  });

  it('parses forced action (!)', () => {
    const tokens = parseFountain('!INT. LOBBY - DAY');
    expect(types(tokens)).toEqual(['action']);
    expect(tokens[0].text).toBe('INT. LOBBY - DAY');
  });

  // ── Scene headings ───────────────────────────────────────────────────────

  it('auto-detects INT scene heading', () => {
    const tokens = parseFountain('\nINT. OFFICE - DAY\n');
    expect(ofType(tokens, 'scene_heading')).toHaveLength(1);
    expect(ofType(tokens, 'scene_heading')[0].text).toBe('INT. OFFICE - DAY');
  });

  it('auto-detects EXT scene heading', () => {
    const tokens = parseFountain('\nEXT. STREET - NIGHT\n');
    expect(ofType(tokens, 'scene_heading')[0].text).toBe('EXT. STREET - NIGHT');
  });

  it('auto-detects INT./EXT. scene heading', () => {
    const tokens = parseFountain('\nINT./EXT. CAR - DAY\n');
    expect(ofType(tokens, 'scene_heading')).toHaveLength(1);
  });

  it('auto-detects I/E scene heading', () => {
    const tokens = parseFountain('\nI/E DINER - DUSK\n');
    expect(ofType(tokens, 'scene_heading')).toHaveLength(1);
  });

  it('parses forced scene heading (.text)', () => {
    const tokens = parseFountain('.THE WOODS AT NIGHT');
    expect(ofType(tokens, 'scene_heading')).toHaveLength(1);
    expect(ofType(tokens, 'scene_heading')[0].text).toBe('THE WOODS AT NIGHT');
  });

  it('does not treat .. as a forced scene heading', () => {
    const tokens = parseFountain('..something');
    expect(ofType(tokens, 'scene_heading')).toHaveLength(0);
  });

  it('does not auto-detect INT without a preceding blank line (mid-action)', () => {
    // INT. preceded by non-blank = not a scene heading
    const tokens = parseFountain('Some action line\nINT. OFFICE - DAY\n');
    expect(ofType(tokens, 'scene_heading')).toHaveLength(0);
  });

  // ── Character ────────────────────────────────────────────────────────────

  it('auto-detects ALL CAPS character cue', () => {
    const input = '\nJOHN\nHello there.\n';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'character')).toHaveLength(1);
    expect(ofType(tokens, 'character')[0].text).toBe('JOHN');
  });

  it('parses forced character (@)', () => {
    const input = '\n@lowercase name\nSays something.\n';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'character')[0].text).toBe('lowercase name');
  });

  it('does not treat ALL CAPS with no following line as character', () => {
    const input = '\nJOHN\n';
    const tokens = parseFountain(input);
    // No next non-blank line — should not be character
    expect(ofType(tokens, 'character')).toHaveLength(0);
  });

  it('character cue strips inline notes', () => {
    const input = '\nJOHN [[V.O.]]\nHello.\n';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'character')[0].text).toBe('JOHN');
  });

  // ── Dialogue & parenthetical ─────────────────────────────────────────────

  it('parses character + dialogue sequence', () => {
    const input = '\nJANE\nI knew you would come.\n';
    const tokens = parseFountain(input);
    expect(types(tokens)).toContain('character');
    expect(types(tokens)).toContain('dialogue');
    expect(ofType(tokens, 'dialogue')[0].text).toBe('I knew you would come.');
  });

  it('parses parenthetical within dialogue', () => {
    const input = '\nJANE\n(whispering)\nI knew you would come.\n';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'parenthetical')).toHaveLength(1);
    expect(ofType(tokens, 'parenthetical')[0].text).toBe('(whispering)');
    expect(ofType(tokens, 'dialogue')).toHaveLength(1);
  });

  it('parses multi-line dialogue block', () => {
    const input = '\nJOHN\nFirst line.\nSecond line.\n';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'dialogue')).toHaveLength(2);
  });

  // ── Transition ───────────────────────────────────────────────────────────

  it('auto-detects CUT TO: transition', () => {
    const input = '\nCUT TO:\n\n';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'transition')).toHaveLength(1);
    expect(ofType(tokens, 'transition')[0].text).toBe('CUT TO:');
  });

  it('auto-detects FADE OUT. transition', () => {
    const input = '\nFADE OUT.\n\n';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'transition')).toHaveLength(1);
  });

  it('auto-detects FADE TO BLACK. transition', () => {
    const input = '\nFADE TO BLACK.\n\n';
    expect(ofType(parseFountain(input), 'transition')).toHaveLength(1);
  });

  it('parses forced transition (>text)', () => {
    const input = '> MATCH CUT TO:';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'transition')).toHaveLength(1);
    expect(ofType(tokens, 'transition')[0].text).toBe('MATCH CUT TO:');
  });

  it('does not treat >text< as transition (that is centered)', () => {
    const input = '> CENTERED TEXT <';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'centered')).toHaveLength(1);
    expect(ofType(tokens, 'transition')).toHaveLength(0);
  });

  // ── Centered text ────────────────────────────────────────────────────────

  it('parses centered text (>text<)', () => {
    const input = '> THE END <';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'centered')).toHaveLength(1);
    expect(ofType(tokens, 'centered')[0].text).toBe('THE END');
  });

  // ── Lyric ────────────────────────────────────────────────────────────────

  it('parses lyric (~)', () => {
    const input = '~ And she sang in the night.';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'lyric')).toHaveLength(1);
    expect(ofType(tokens, 'lyric')[0].text).toBe('And she sang in the night.');
  });

  // ── Page break ───────────────────────────────────────────────────────────

  it('parses page break (===)', () => {
    const input = 'Some action.\n===\nMore action.';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'page_break')).toHaveLength(1);
  });

  it('parses page break with extra equals (====)', () => {
    const input = '====';
    expect(ofType(parseFountain(input), 'page_break')).toHaveLength(1);
  });

  // ── Inline note ──────────────────────────────────────────────────────────

  it('parses standalone note ([[...]])', () => {
    const input = '[[This is a note]]';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'note')).toHaveLength(1);
    expect(ofType(tokens, 'note')[0].text).toBe('This is a note');
  });

  it('strips inline notes from action text', () => {
    const input = 'John walks [[director note]] into the room.';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'action')[0].text).toBe('John walks  into the room.');
  });

  // ── Boneyard ─────────────────────────────────────────────────────────────

  it('strips boneyard (/* ... */) content', () => {
    const input = 'Action line.\n/* This is hidden. */\nAnother line.';
    const tokens = parseFountain(input);
    const actionTexts = ofType(tokens, 'action').map(t => t.text);
    expect(actionTexts).not.toContain('This is hidden.');
    expect(actionTexts).toContain('Action line.');
    expect(actionTexts).toContain('Another line.');
  });

  it('strips multi-line boneyard', () => {
    const input = 'Before.\n/* Line one.\nLine two. */\nAfter.';
    const tokens = parseFountain(input);
    const actionTexts = ofType(tokens, 'action').map(t => t.text);
    expect(actionTexts).toContain('Before.');
    expect(actionTexts).toContain('After.');
    expect(actionTexts.join(' ')).not.toContain('Line one');
  });

  // ── Title page ───────────────────────────────────────────────────────────

  it('parses title page key:value pairs', () => {
    const input = 'Title: My Script\nAuthor: Jane Smith\nCredit: Written by\n\nINT. ROOM - DAY\n';
    const tokens = parseFountain(input);
    const tp = ofType(tokens, 'title_page');
    expect(tp).toHaveLength(3);
    expect(tp[0].text).toBe('Title: My Script');
    expect(tp[1].text).toBe('Author: Jane Smith');
  });

  it('does not parse title page if first line is not key:value', () => {
    const input = 'INT. OFFICE - DAY\nTitle: My Script\n';
    const tokens = parseFountain(input);
    expect(ofType(tokens, 'title_page')).toHaveLength(0);
  });

  // ── Full screenplay snippet ──────────────────────────────────────────────

  it('parses a complete dialogue scene correctly', () => {
    const input = [
      'Title: Test Script',
      'Author: Me',
      '',
      'INT. COFFEE SHOP - DAY',
      '',
      'Alice enters and sits down.',
      '',
      'ALICE',
      'Is anyone sitting here?',
      '',
      'BOB',
      '(looking up)',
      'No, go ahead.',
      '',
      'CUT TO:',
      '',
    ].join('\n');

    const tokens = parseFountain(input);

    expect(ofType(tokens, 'title_page')).toHaveLength(2);
    expect(ofType(tokens, 'scene_heading')).toHaveLength(1);
    expect(ofType(tokens, 'action')).toHaveLength(1);
    expect(ofType(tokens, 'character')).toHaveLength(2);
    expect(ofType(tokens, 'dialogue')).toHaveLength(2);
    expect(ofType(tokens, 'parenthetical')).toHaveLength(1);
    expect(ofType(tokens, 'transition')).toHaveLength(1);
  });

});

// ─── processInlineMarkup ──────────────────────────────────────────────────────

describe('processInlineMarkup', () => {

  it('passes plain text through unchanged', () => {
    expect(processInlineMarkup('Hello world')).toBe('Hello world');
  });

  it('escapes < > & characters', () => {
    // htmlEscape covers &, <, > — quotes are not escaped (output is used in
    // innerHTML, not HTML attributes, so this is intentional)
    expect(processInlineMarkup('<b> & </b>')).toBe('&lt;b&gt; &amp; &lt;/b&gt;');
  });

  it('escapes ampersands', () => {
    expect(processInlineMarkup('bread & butter')).toBe('bread &amp; butter');
  });

  it('renders bold (**text**)', () => {
    expect(processInlineMarkup('**bold**')).toBe('<strong>bold</strong>');
  });

  it('renders italic (*text*)', () => {
    expect(processInlineMarkup('*italic*')).toBe('<em>italic</em>');
  });

  it('renders underline (_text_)', () => {
    expect(processInlineMarkup('_underline_')).toBe('<u>underline</u>');
  });

  it('renders bold+italic (***text***)', () => {
    expect(processInlineMarkup('***both***')).toBe('<strong><em>both</em></strong>');
  });

  it('handles mixed inline markup in one string', () => {
    const result = processInlineMarkup('Hello **world** and *everyone*.');
    expect(result).toBe('Hello <strong>world</strong> and <em>everyone</em>.');
  });

  it('does not corrupt text outside markup spans', () => {
    const result = processInlineMarkup('Before **bold** after.');
    expect(result).toContain('Before ');
    expect(result).toContain(' after.');
  });

});
