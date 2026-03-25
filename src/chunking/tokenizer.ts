/**
 * Tokenizer module — ported from Google LangExtract.
 *
 * Two tokenizers:
 * - RegexTokenizer: fast, ASCII/Latin-optimized
 * - UnicodeTokenizer: handles CJK, Thai, Arabic, Devanagari via Intl.Segmenter
 */

export interface Token {
  /** The token text. */
  text: string;
  /** Start character offset in the source text. */
  start: number;
  /** End character offset (exclusive) in the source text. */
  end: number;
  /** True if there was a newline between this token and the previous one. */
  firstTokenAfterNewline: boolean;
}

/**
 * Regex-based tokenizer for ASCII/Latin text.
 * Pattern: word chars | digits | groups of identical symbols.
 * Ported from LangExtract's RegexTokenizer.
 */
const TOKEN_PATTERN = /[^\W\d_]+|\d+|([^\w\s]|_)\1*/g;

export function regexTokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let prevEnd = 0;
  let match: RegExpExecArray | null;

  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    const gap = text.slice(prevEnd, match.index);
    const hasNewline = /[\n\r]/.test(gap);

    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      firstTokenAfterNewline: hasNewline,
    });
    prevEnd = match.index + match[0].length;
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Script detection for UnicodeTokenizer
// ---------------------------------------------------------------------------

const CJK_RANGES =
  /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uAC00-\uD7AF]/;
const THAI_RANGES = /[\u0E00-\u0E7F]/;
const LAO_RANGES = /[\u0E80-\u0EFF]/;
const KHMER_RANGES = /[\u1780-\u17FF]/;
const MYANMAR_RANGES = /[\u1000-\u109F]/;

function isNonSpacedScript(char: string): boolean {
  return (
    CJK_RANGES.test(char) ||
    THAI_RANGES.test(char) ||
    LAO_RANGES.test(char) ||
    KHMER_RANGES.test(char) ||
    MYANMAR_RANGES.test(char)
  );
}

type GraphemeType = 'word' | 'number' | 'punctuation' | 'whitespace';

function classifyGrapheme(grapheme: string): GraphemeType {
  if (/\s/.test(grapheme)) return 'whitespace';
  if (/\d/.test(grapheme)) return 'number';
  if (/[^\w]/.test(grapheme) || grapheme === '_') return 'punctuation';
  return 'word';
}

/**
 * Unicode-aware tokenizer using Intl.Segmenter.
 * Handles CJK, Thai, and other non-spaced scripts.
 * Ported from LangExtract's UnicodeTokenizer.
 */
export function unicodeTokenize(text: string): Token[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const segments = [...segmenter.segment(text)];
  const tokens: Token[] = [];

  let currentText = '';
  let currentStart = 0;
  let currentType: GraphemeType | null = null;
  let prevEnd = 0;
  let newlineSeen = false;

  function flush() {
    if (currentText.length > 0 && currentType !== 'whitespace') {
      tokens.push({
        text: currentText,
        start: currentStart,
        end: currentStart + currentText.length,
        firstTokenAfterNewline: newlineSeen,
      });
      newlineSeen = false;
    }
    currentText = '';
    currentType = null;
  }

  for (const seg of segments) {
    const char = seg.segment;
    const idx = seg.index;
    const type = classifyGrapheme(char);

    if (type === 'whitespace') {
      if (/[\n\r]/.test(char)) newlineSeen = true;
      flush();
      prevEnd = idx + char.length;
      continue;
    }

    // Non-spaced scripts: each character is its own token
    if (type === 'word' && isNonSpacedScript(char)) {
      flush();
      // Check gap for newlines
      const gap = text.slice(prevEnd, idx);
      if (/[\n\r]/.test(gap)) newlineSeen = true;

      tokens.push({
        text: char,
        start: idx,
        end: idx + char.length,
        firstTokenAfterNewline: newlineSeen,
      });
      newlineSeen = false;
      prevEnd = idx + char.length;
      continue;
    }

    // Punctuation: only merge identical punctuation (e.g. "!!" merges, "!?" does not)
    if (type === 'punctuation') {
      if (currentType === 'punctuation' && currentText.length > 0 && currentText[0] === char) {
        currentText += char;
      } else {
        flush();
        const gap = text.slice(prevEnd, idx);
        if (/[\n\r]/.test(gap)) newlineSeen = true;
        currentStart = idx;
        currentType = type;
        currentText = char;
      }
      prevEnd = idx + char.length;
      continue;
    }

    // Same type as current — merge
    if (type === currentType) {
      currentText += char;
      prevEnd = idx + char.length;
      continue;
    }

    // Different type — flush and start new
    flush();
    const gap = text.slice(prevEnd, idx);
    if (/[\n\r]/.test(gap)) newlineSeen = true;
    currentStart = idx;
    currentType = type;
    currentText = char;
    prevEnd = idx + char.length;
  }

  flush();
  return tokens;
}

/**
 * Auto-select tokenizer based on content.
 * Uses Unicode tokenizer if non-spaced scripts are detected.
 */
export function tokenize(text: string): Token[] {
  // Quick check: if text contains CJK/Thai/etc., use unicode tokenizer
  if (isNonSpacedScript(text.slice(0, 200))) {
    return unicodeTokenize(text);
  }
  return regexTokenize(text);
}
