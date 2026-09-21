const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'generator',
  'pict', 'object', 'themedata', 'colorschememapping',
  'latentstyles', 'rsidtbl', 'listtable', 'listoverridetable',
  'filetbl', 'xmlnstbl',
]);

const WIN1252_EXTRA = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„',
  0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ',
  0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ',
  0x8E: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“',
  0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›',
  0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ',
};

function decodeWin1252Byte(byte) {
  return WIN1252_EXTRA[byte] ?? String.fromCharCode(byte);
}

const TOKEN_RE =
  /\\'([0-9a-fA-F]{2})|\\u(-?\d+) ?|\\([a-zA-Z]+)(-?\d+)?[ ]?|\\([^a-zA-Z\r\n])|([{}])|[\r\n]+|([^\\{}\r\n]+)/g;

export function rtfToPlainText(rtf) {
  if (typeof rtf !== 'string' || rtf.length === 0) return '';

  let out = '';
  const skipStack = [false];
  const ucStack = [1];
  let pendingUnicodeSkip = 0;
  const isSkipped = () => skipStack[skipStack.length - 1];

  const re = new RegExp(TOKEN_RE);
  let match;
  while ((match = re.exec(rtf)) !== null) {
    const [, hex, uni, word, wordArg, symbol, brace, text] = match;

    if (brace === '{') {
      skipStack.push(isSkipped());
      ucStack.push(ucStack[ucStack.length - 1]);
      continue;
    }
    if (brace === '}') {
      if (skipStack.length > 1) skipStack.pop();
      if (ucStack.length > 1) ucStack.pop();
      continue;
    }

    if (symbol === '*') {
      skipStack[skipStack.length - 1] = true;
      continue;
    }

    if (word !== undefined) {
      if (SKIP_DESTINATIONS.has(word)) {
        skipStack[skipStack.length - 1] = true;
      }
      if (word === 'uc' && wordArg !== undefined) {
        ucStack[ucStack.length - 1] = parseInt(wordArg, 10);
      }
      if (isSkipped()) continue;
      if (pendingUnicodeSkip > 0) pendingUnicodeSkip--;
      if (word === 'par' || word === 'line') out += '\n';
      else if (word === 'tab') out += '\t';
      continue;
    }

    if (isSkipped()) continue;

    if (hex !== undefined) {
      if (pendingUnicodeSkip > 0) { pendingUnicodeSkip--; continue; }
      out += decodeWin1252Byte(parseInt(hex, 16));
      continue;
    }

    if (uni !== undefined) {
      let code = parseInt(uni, 10);
      if (code < 0) code += 65536;
      out += String.fromCodePoint(code);
      pendingUnicodeSkip = ucStack[ucStack.length - 1];
      continue;
    }

    if (symbol !== undefined) {
      if (pendingUnicodeSkip > 0) { pendingUnicodeSkip--; continue; }
      if (symbol === '\\' || symbol === '{' || symbol === '}') out += symbol;
      else if (symbol === '~') out += ' ';
      continue;
    }

    if (text !== undefined) {
      if (pendingUnicodeSkip > 0) {
        let remaining = text;
        while (pendingUnicodeSkip > 0 && remaining.length > 0) {
          remaining = remaining.slice(1);
          pendingUnicodeSkip--;
        }
        out += remaining;
      } else {
        out += text;
      }
    }
  }

  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}
