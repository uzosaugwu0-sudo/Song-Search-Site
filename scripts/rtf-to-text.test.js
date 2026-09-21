import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rtfToPlainText } from './rtf-to-text.js';

const HYMN_RTF = String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2639
{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\pard\sa0\qc\partightenfactor0
\f0\fs28 \cf0 Amazing grace, how sweet the sound\par
That saved a wretch like me\par
\par
I once was lost, but now am found\par
Was blind but now I see}`;

test('converts paragraphs to newlines and preserves blank lines between verses', () => {
  const result = rtfToPlainText(HYMN_RTF);
  assert.equal(
    result,
    'Amazing grace, how sweet the sound\n' +
      'That saved a wretch like me\n' +
      '\n' +
      'I once was lost, but now am found\n' +
      'Was blind but now I see'
  );
});

test('strips font table and color table content instead of rendering it', () => {
  const result = rtfToPlainText(HYMN_RTF);
  assert.ok(!result.includes('Helvetica'));
  assert.ok(!result.includes('fonttbl'));
});

test('decodes hex-escaped Windows-1252 bytes', () => {
  assert.equal(rtfToPlainText(String.raw`Caf\'e9`), 'Caf' + String.fromCharCode(0xE9));
});

test('decodes \\uN unicode escapes and swallows the ASCII fallback char', () => {
  assert.equal(rtfToPlainText(String.raw`Caf\u233?`), 'Caf' + String.fromCharCode(0xE9));
});

test('returns an empty string for empty or whitespace-only RTF', () => {
  assert.equal(rtfToPlainText(''), '');
  assert.equal(rtfToPlainText(String.raw`{\rtf1\ansi \par }`), '');
});

test('returns an empty string for non-string input', () => {
  assert.equal(rtfToPlainText(null), '');
  assert.equal(rtfToPlainText(undefined), '');
});

test('respects \\ucN so it swallows the correct number of unicode fallback characters', () => {
  const inputRTF = '\\uc0\\u8217no fallback swallowed';
  const expected = String.fromCharCode(0x2019) + 'no fallback swallowed';
  assert.equal(rtfToPlainText(inputRTF), expected);
});

test('\\uc reverts to its previous value when the enclosing group closes', () => {
  const inputRTF = '{\\uc0\\u8217}\\u233?';
  const expected = String.fromCharCode(0x2019) + String.fromCharCode(0xE9);
  assert.equal(rtfToPlainText(inputRTF), expected);
});
