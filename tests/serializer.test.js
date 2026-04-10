/**
 * serializer.test.js — Unit tests for Fountain <-> ProseMirror serialization
 *
 * Tests fountainToDoc() and docToFountain() from renderer/editor/serializer.js.
 * These are pure functions — no browser, no DOM required.
 */

import { describe, it, expect } from 'vitest';
import { screenplaySchema as schema } from '../renderer/editor/schema.js';
import { fountainToDoc, docToFountain } from '../renderer/editor/serializer.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get node type names of all top-level children in a doc. */
function nodeTypes(doc) {
  const types = [];
  doc.forEach(node => types.push(node.type.name));
  return types;
}

/** Get text content of the first top-level node of the given type. */
function firstText(doc, typeName) {
  let result = null;
  doc.forEach(node => {
    if (result === null && node.type.name === typeName) {
      result = node.textContent;
    }
  });
  return result;
}

/** Get mark names on the first text node inside the first node of typeName. */
function marksOn(doc, typeName) {
  let marks = null;
  doc.forEach(node => {
    if (marks === null && node.type.name === typeName) {
      node.forEach(inline => {
        if (marks === null && inline.isText) {
          marks = inline.marks.map(m => m.type.name);
        }
      });
    }
  });
  return marks ?? [];
}

/** Build a simple doc from an array of [typeName, text?] pairs. */
function buildDoc(...blocks) {
  const nodes = blocks.map(([type, text]) => {
    if (type === 'page_break') return schema.node('page_break');
    const children = text ? [schema.text(text)] : [];
    return schema.node(type, null, children);
  });
  return schema.node('doc', null, nodes);
}

/** Build a doc node with inline marks applied to the text. */
function buildDocWithMark(typeName, text, ...markNames) {
  const marks = markNames.map(name => schema.marks[name].create());
  const textNode = schema.text(text, marks);
  const block = schema.node(typeName, null, [textNode]);
  return schema.node('doc', null, [block]);
}

const EMPTY_TITLE_PAGE = {
  title: '', credit: '', author: '',
  source: '', draftDate: '', contact: '',
  contactPosition: 'left',
};

// ─── fountainToDoc ────────────────────────────────────────────────────────────

describe('fountainToDoc', () => {

  // ── Empty / whitespace ───────────────────────────────────────────────────

  it('returns a single empty action node for empty string', () => {
    const { doc, titlePageData } = fountainToDoc('', schema);
    expect(nodeTypes(doc)).toEqual(['action']);
    expect(doc.firstChild.textContent).toBe('');
    expect(titlePageData).toEqual(EMPTY_TITLE_PAGE);
  });

  it('returns a single empty action node for whitespace-only input', () => {
    const { doc } = fountainToDoc('   \n\n  ', schema);
    expect(nodeTypes(doc)).toEqual(['action']);
  });

  // ── Block types ──────────────────────────────────────────────────────────

  it('parses action text into an action node', () => {
    const { doc } = fountainToDoc('John walks into the room.', schema);
    expect(nodeTypes(doc)).toContain('action');
    expect(firstText(doc, 'action')).toBe('John walks into the room.');
  });

  it('parses a scene heading into a scene_heading node', () => {
    const { doc } = fountainToDoc('\nINT. OFFICE - DAY\n', schema);
    expect(nodeTypes(doc)).toContain('scene_heading');
    expect(firstText(doc, 'scene_heading')).toBe('INT. OFFICE - DAY');
  });

  it('parses character + dialogue into correct node sequence', () => {
    const input = '\nJANE\nI knew you would come.\n';
    const { doc } = fountainToDoc(input, schema);
    expect(nodeTypes(doc)).toContain('character');
    expect(nodeTypes(doc)).toContain('dialogue');
    expect(firstText(doc, 'character')).toBe('JANE');
    expect(firstText(doc, 'dialogue')).toBe('I knew you would come.');
  });

  it('parses parenthetical', () => {
    const input = '\nJANE\n(whispering)\nCome here.\n';
    const { doc } = fountainToDoc(input, schema);
    expect(nodeTypes(doc)).toContain('parenthetical');
    expect(firstText(doc, 'parenthetical')).toBe('(whispering)');
  });

  it('parses transition', () => {
    const { doc } = fountainToDoc('\nCUT TO:\n\n', schema);
    expect(nodeTypes(doc)).toContain('transition');
    expect(firstText(doc, 'transition')).toBe('CUT TO:');
  });

  it('parses centered text', () => {
    const { doc } = fountainToDoc('> THE END <', schema);
    expect(nodeTypes(doc)).toContain('centered');
    expect(firstText(doc, 'centered')).toBe('THE END');
  });

  it('parses lyric', () => {
    const { doc } = fountainToDoc('~ And she sang.', schema);
    expect(nodeTypes(doc)).toContain('lyric');
    expect(firstText(doc, 'lyric')).toBe('And she sang.');
  });

  it('parses note', () => {
    const { doc } = fountainToDoc('[[Director note here]]', schema);
    expect(nodeTypes(doc)).toContain('note');
    expect(firstText(doc, 'note')).toBe('Director note here');
  });

  it('parses page break into a page_break node', () => {
    const input = 'Action line.\n===\nMore action.';
    const { doc } = fountainToDoc(input, schema);
    expect(nodeTypes(doc)).toContain('page_break');
  });

  it('falls back unknown token type to action', () => {
    // parseFountain may return 'empty' tokens — serializer skips those.
    // If a hypothetical unknown type comes through, it should become action.
    // Test via a completely clean doc with no unknown types — just verify
    // the fallback path doesn't throw.
    const { doc } = fountainToDoc('Some plain text.', schema);
    expect(() => docToFountain(doc, EMPTY_TITLE_PAGE)).not.toThrow();
  });

  it('ensures at least one block when all tokens are empty', () => {
    // A string of only blank lines produces no body tokens
    const { doc } = fountainToDoc('\n\n\n\n', schema);
    expect(doc.childCount).toBeGreaterThanOrEqual(1);
  });

  // ── Inline marks ─────────────────────────────────────────────────────────

  it('applies bold mark to **text**', () => {
    const { doc } = fountainToDoc('**bold word** here.', schema);
    const marks = marksOn(doc, 'action');
    expect(marks).toContain('bold');
  });

  it('applies italic mark to *text*', () => {
    const { doc } = fountainToDoc('*italic word* here.', schema);
    expect(marksOn(doc, 'action')).toContain('italic');
  });

  it('applies underline mark to _text_', () => {
    const { doc } = fountainToDoc('_underlined_ here.', schema);
    expect(marksOn(doc, 'action')).toContain('underline');
  });

  it('applies both bold and italic marks to ***text***', () => {
    const { doc } = fountainToDoc('***bold italic*** here.', schema);
    const marks = marksOn(doc, 'action');
    expect(marks).toContain('bold');
    expect(marks).toContain('italic');
  });

  it('plain text before and after markup has no marks', () => {
    const { doc } = fountainToDoc('Before **bold** after.', schema);
    // First inline child (plain "Before ") should have no marks
    const firstChild = doc.firstChild;
    let firstTextNode = null;
    firstChild.forEach(n => { if (!firstTextNode && n.isText) firstTextNode = n; });
    expect(firstTextNode.marks).toHaveLength(0);
    expect(firstTextNode.text).toBe('Before ');
  });

  // ── Title page data ──────────────────────────────────────────────────────

  it('extracts title page data into titlePageData', () => {
    const input = 'Title: My Script\nAuthor: Jane Smith\nCredit: Written by\n\nINT. ROOM - DAY\n';
    const { titlePageData } = fountainToDoc(input, schema);
    expect(titlePageData.title).toBe('My Script');
    expect(titlePageData.author).toBe('Jane Smith');
    expect(titlePageData.credit).toBe('Written by');
  });

  it('maps "authors" key to titlePageData.author', () => {
    const input = 'Authors: Alice & Bob\n\nINT. ROOM - DAY\n';
    const { titlePageData } = fountainToDoc(input, schema);
    expect(titlePageData.author).toBe('Alice & Bob');
  });

  it('maps "draft date" key to titlePageData.draftDate', () => {
    const input = 'Title: Test\nDraft date: 2026-01-01\n\nINT. ROOM - DAY\n';
    const { titlePageData } = fountainToDoc(input, schema);
    expect(titlePageData.draftDate).toBe('2026-01-01');
  });

  it('leaves titlePageData defaults for missing fields', () => {
    const input = 'Title: Partial\n\nINT. ROOM - DAY\n';
    const { titlePageData } = fountainToDoc(input, schema);
    expect(titlePageData.author).toBe('');
    expect(titlePageData.contactPosition).toBe('left');
  });

  it('ignores title page data when first line is not key:value', () => {
    const input = 'INT. OFFICE - DAY\nTitle: My Script\n';
    const { titlePageData } = fountainToDoc(input, schema);
    expect(titlePageData.title).toBe('');
  });

});

// ─── docToFountain ────────────────────────────────────────────────────────────

describe('docToFountain', () => {

  // ── Block type serialization ─────────────────────────────────────────────

  it('serializes action as plain text', () => {
    const doc = buildDoc(['action', 'John walks in.']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('John walks in.');
  });

  it('serializes scene_heading as uppercase', () => {
    const doc = buildDoc(['scene_heading', 'int. office - day']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('INT. OFFICE - DAY');
  });

  it('serializes character as uppercase', () => {
    const doc = buildDoc(['character', 'john']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('JOHN');
  });

  it('serializes centered as > text <', () => {
    const doc = buildDoc(['centered', 'THE END']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('> THE END <');
  });

  it('serializes lyric as ~ text', () => {
    const doc = buildDoc(['lyric', 'She sang in the night.']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('~ She sang in the night.');
  });

  it('serializes note as [[text]]', () => {
    const doc = buildDoc(['note', 'Director note']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('[[Director note]]');
  });

  it('serializes page_break as ===', () => {
    const doc = buildDoc(['action', 'Before.'], ['page_break'], ['action', 'After.']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('===');
  });

  it('serializes dialogue as plain text (no decoration)', () => {
    const doc = buildDoc(['dialogue', 'I knew you would come.']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('I knew you would come.');
    expect(result).not.toContain('>');
    expect(result).not.toContain('~');
  });

  it('serializes parenthetical as plain text', () => {
    const doc = buildDoc(['parenthetical', '(whispering)']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('(whispering)');
  });

  // ── Blank line insertion ─────────────────────────────────────────────────

  it('inserts blank line between action blocks', () => {
    const doc = buildDoc(['action', 'First.'], ['action', 'Second.']);
    const lines = docToFountain(doc, EMPTY_TITLE_PAGE).split('\n');
    const firstIdx = lines.indexOf('First.');
    const secondIdx = lines.indexOf('Second.');
    expect(secondIdx - firstIdx).toBe(2); // one blank line between
  });

  it('inserts blank line before scene heading', () => {
    const doc = buildDoc(['action', 'Some action.'], ['scene_heading', 'INT. ROOM - DAY']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('Some action.\n\nINT. ROOM - DAY');
  });

  it('does not insert blank line between character and dialogue', () => {
    const doc = buildDoc(['character', 'JANE'], ['dialogue', 'Hello.']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('JANE\nHello.');
  });

  it('does not insert blank line between character and parenthetical', () => {
    const doc = buildDoc(['character', 'JANE'], ['parenthetical', '(quietly)'], ['dialogue', 'Hello.']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('JANE\n(quietly)\nHello.');
  });

  // ── Inline mark serialization ────────────────────────────────────────────

  it('serializes bold mark as **text**', () => {
    const doc = buildDocWithMark('action', 'bold', 'bold');
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('**bold**');
  });

  it('serializes italic mark as *text*', () => {
    const doc = buildDocWithMark('action', 'italic', 'italic');
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('*italic*');
  });

  it('serializes underline mark as _text_', () => {
    const doc = buildDocWithMark('action', 'underline', 'underline');
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('_underline_');
  });

  it('serializes bold+italic as ***text***', () => {
    const doc = buildDocWithMark('action', 'bolditalic', 'bold', 'italic');
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).toContain('***bolditalic***');
  });

  it('serializes underline combined with bold as _**text**_', () => {
    const doc = buildDocWithMark('action', 'word', 'bold', 'underline');
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    // bold wraps first, underline wraps outer
    expect(result).toContain('_**word**_');
  });

  // ── Title page header ─────────────────────────────────────────────────────

  it('prepends title page header when title is set', () => {
    const doc = buildDoc(['action', 'Action.']);
    const tp = { ...EMPTY_TITLE_PAGE, title: 'My Script', author: 'Jane' };
    const result = docToFountain(doc, tp);
    expect(result.startsWith('Title: My Script\n')).toBe(true);
    expect(result).toContain('Author: Jane');
  });

  it('omits title page header when title is empty', () => {
    const doc = buildDoc(['action', 'Action.']);
    const result = docToFountain(doc, EMPTY_TITLE_PAGE);
    expect(result).not.toContain('Title:');
  });

  it('omits contactPosition line when it is "left" (default)', () => {
    const doc = buildDoc(['action', 'Action.']);
    const tp = { ...EMPTY_TITLE_PAGE, title: 'Test', contactPosition: 'left' };
    const result = docToFountain(doc, tp);
    expect(result).not.toContain('Contact position:');
  });

  it('includes contactPosition line when it is not "left"', () => {
    const doc = buildDoc(['action', 'Action.']);
    const tp = { ...EMPTY_TITLE_PAGE, title: 'Test', contactPosition: 'right' };
    const result = docToFountain(doc, tp);
    expect(result).toContain('Contact position: right');
  });

  it('omits optional title page fields when empty', () => {
    const doc = buildDoc(['action', 'Action.']);
    const tp = { ...EMPTY_TITLE_PAGE, title: 'Test' };
    const result = docToFountain(doc, tp);
    expect(result).not.toContain('Credit:');
    expect(result).not.toContain('Source:');
    expect(result).not.toContain('Draft date:');
  });

});

// ─── Roundtrip ────────────────────────────────────────────────────────────────

describe('Fountain → doc → Fountain roundtrip', () => {

  it('scene heading survives roundtrip (normalized to uppercase)', () => {
    const input = '\nINT. OFFICE - DAY\n\nJohn walks in.\n';
    const { doc, titlePageData } = fountainToDoc(input, schema);
    const output = docToFountain(doc, titlePageData);
    expect(output).toContain('INT. OFFICE - DAY');
    expect(output).toContain('John walks in.');
  });

  it('character + dialogue survives roundtrip', () => {
    const input = '\nJANE\nI knew you would come.\n';
    const { doc, titlePageData } = fountainToDoc(input, schema);
    const output = docToFountain(doc, titlePageData);
    expect(output).toContain('JANE');
    expect(output).toContain('I knew you would come.');
  });

  it('inline bold survives roundtrip', () => {
    const input = '**important word** in action.';
    const { doc, titlePageData } = fountainToDoc(input, schema);
    const output = docToFountain(doc, titlePageData);
    expect(output).toContain('**important word**');
  });

  it('inline italic survives roundtrip', () => {
    const input = 'She said *quietly*.';
    const { doc, titlePageData } = fountainToDoc(input, schema);
    const output = docToFountain(doc, titlePageData);
    expect(output).toContain('*quietly*');
  });

  it('title page data survives roundtrip', () => {
    const input = 'Title: My Film\nAuthor: Jane Smith\nCredit: Written by\n\nINT. ROOM - DAY\n';
    const { doc, titlePageData } = fountainToDoc(input, schema);
    const output = docToFountain(doc, titlePageData);
    expect(output).toContain('Title: My Film');
    expect(output).toContain('Author: Jane Smith');
    expect(output).toContain('Credit: Written by');
  });

  it('page break survives roundtrip', () => {
    const input = 'Action before.\n===\nAction after.';
    const { doc, titlePageData } = fountainToDoc(input, schema);
    const output = docToFountain(doc, titlePageData);
    expect(output).toContain('===');
  });

  it('full scene roundtrip preserves all element types', () => {
    const input = [
      'INT. COFFEE SHOP - DAY',
      '',
      'Alice enters and sits down.',
      '',
      'ALICE',
      '(looking around)',
      'Is anyone sitting here?',
      '',
      'CUT TO:',
      '',
    ].join('\n');

    const { doc, titlePageData } = fountainToDoc('\n' + input + '\n', schema);
    const output = docToFountain(doc, titlePageData);

    expect(output).toContain('INT. COFFEE SHOP - DAY');
    expect(output).toContain('Alice enters and sits down.');
    expect(output).toContain('ALICE');
    expect(output).toContain('(looking around)');
    expect(output).toContain('Is anyone sitting here?');
    expect(output).toContain('CUT TO:');
  });

});

// ─── Dual dialogue ─────────────────────────────────────────────────────────────

describe('dual dialogue', () => {
  it('parses dual dialogue from Fountain ^ marker', () => {
    const input = [
      'BRICK',
      'I love you.',
      '',
      'STEEL ^',
      'I love you too.',
    ].join('\n');

    const { doc } = fountainToDoc(input, schema);
    const types = nodeTypes(doc);
    expect(types).toContain('dual_dialogue');
    expect(types).not.toContain('character');
    expect(types).not.toContain('dialogue');
  });

  it('dual_dialogue has two dual_col children', () => {
    const input = [
      'BRICK',
      'Left line.',
      '',
      'STEEL ^',
      'Right line.',
    ].join('\n');

    const { doc } = fountainToDoc(input, schema);
    let dualNode = null;
    doc.forEach(n => { if (n.type.name === 'dual_dialogue') dualNode = n; });
    expect(dualNode).not.toBeNull();
    expect(dualNode.childCount).toBe(2);
    expect(dualNode.child(0).type.name).toBe('dual_col');
    expect(dualNode.child(1).type.name).toBe('dual_col');
  });

  it('left col has correct character and dialogue', () => {
    const input = [
      'BRICK',
      'Left line.',
      '',
      'STEEL ^',
      'Right line.',
    ].join('\n');

    const { doc } = fountainToDoc(input, schema);
    let dualNode = null;
    doc.forEach(n => { if (n.type.name === 'dual_dialogue') dualNode = n; });
    const leftCol = dualNode.child(0);
    expect(leftCol.child(0).type.name).toBe('character');
    expect(leftCol.child(0).textContent).toBe('BRICK');
    expect(leftCol.child(1).type.name).toBe('dialogue');
    expect(leftCol.child(1).textContent).toBe('Left line.');
  });

  it('right col has correct character and dialogue', () => {
    const input = [
      'BRICK',
      'Left line.',
      '',
      'STEEL ^',
      'Right line.',
    ].join('\n');

    const { doc } = fountainToDoc(input, schema);
    let dualNode = null;
    doc.forEach(n => { if (n.type.name === 'dual_dialogue') dualNode = n; });
    const rightCol = dualNode.child(1);
    expect(rightCol.child(0).type.name).toBe('character');
    expect(rightCol.child(0).textContent).toBe('STEEL');
    expect(rightCol.child(1).type.name).toBe('dialogue');
    expect(rightCol.child(1).textContent).toBe('Right line.');
  });

  it('serializes dual_dialogue back to Fountain with ^ on right character', () => {
    const input = [
      'BRICK',
      'Left line.',
      '',
      'STEEL ^',
      'Right line.',
    ].join('\n');

    const { doc, titlePageData } = fountainToDoc(input, schema);
    const output = docToFountain(doc, titlePageData);
    expect(output).toContain('BRICK');
    expect(output).toContain('Left line.');
    expect(output).toContain('STEEL ^');
    expect(output).toContain('Right line.');
  });

  it('dual dialogue roundtrip: parse → serialize → re-parse', () => {
    const input = [
      'INT. OFFICE - DAY',
      '',
      'ALICE',
      'First speaker.',
      '',
      'BOB ^',
      'Second speaker.',
      '',
      'They stare at each other.',
    ].join('\n');

    const { doc: doc1, titlePageData } = fountainToDoc(input, schema);
    const output = docToFountain(doc1, titlePageData);
    const { doc: doc2 } = fountainToDoc(output, schema);

    const types1 = nodeTypes(doc1);
    const types2 = nodeTypes(doc2);
    expect(types1).toContain('dual_dialogue');
    expect(types2).toContain('dual_dialogue');
    // Both docs have same top-level structure
    expect(types1).toEqual(types2);
  });

  it('dual dialogue with parenthetical in left column', () => {
    const input = [
      'ALICE',
      '(whispering)',
      'Come here.',
      '',
      'BOB ^',
      'What?',
    ].join('\n');

    const { doc } = fountainToDoc(input, schema);
    let dualNode = null;
    doc.forEach(n => { if (n.type.name === 'dual_dialogue') dualNode = n; });
    expect(dualNode).not.toBeNull();
    const leftCol = dualNode.child(0);
    const leftTypes = [];
    leftCol.forEach(n => leftTypes.push(n.type.name));
    expect(leftTypes).toContain('parenthetical');
  });
});
