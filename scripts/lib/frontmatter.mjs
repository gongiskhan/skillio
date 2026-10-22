// Splits a SKILL.md (or agent/command .md) into YAML frontmatter and body,
// and parses the frontmatter with a small YAML subset parser.
//
// Why a hand-written parser: Skillio has no dependencies, so it runs anywhere
// Node runs (hooks included) without an npm install. The subset covers what
// skill frontmatter uses in practice: scalars (plain, quoted, multi-line
// plain), block scalars (| > with chomping), block and flow sequences,
// and nested maps. Anything it can't parse is reported, not guessed.

export function splitFrontmatter(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  if (lines[0].trim() !== '---') {
    return { hasFrontmatter: false, yaml: '', body: src, bodyStartLine: 1, lines };
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') {
      return {
        hasFrontmatter: true,
        yaml: lines.slice(1, i).join('\n'),
        body: lines.slice(i + 1).join('\n'),
        bodyStartLine: i + 2,
        lines,
      };
    }
  }
  return { hasFrontmatter: false, unterminated: true, yaml: '', body: src, bodyStartLine: 1, lines };
}

export function parseFrontmatter(text) {
  const parts = splitFrontmatter(text);
  if (!parts.hasFrontmatter) {
    return { ...parts, data: null, errors: parts.unterminated ? ['frontmatter starts with --- but never closes'] : [] };
  }
  const errors = [];
  let data = null;
  try {
    data = parseYamlSubset(parts.yaml);
  } catch (e) {
    errors.push(e.message);
  }
  return { ...parts, data, errors };
}

// ---------------------------------------------------------------------------

export function parseYamlSubset(yaml) {
  const raw = yaml.split('\n');
  const lines = raw.map((text, idx) => ({ text, idx, indent: text.match(/^ */)[0].length }));
  const state = { lines, pos: 0 };
  skipBlank(state);
  if (state.pos >= lines.length) return {};
  const value = parseNode(state, lines[state.pos].indent);
  skipBlank(state);
  if (state.pos < lines.length) {
    throw new Error(`YAML: unexpected content at line ${state.pos + 2}: "${lines[state.pos].text.trim()}"`);
  }
  return value;
}

function isBlank(line) {
  const t = line.text.trim();
  return t === '' || t.startsWith('#');
}

function skipBlank(state) {
  while (state.pos < state.lines.length && isBlank(state.lines[state.pos])) state.pos++;
}

function parseNode(state, indent) {
  skipBlank(state);
  const line = state.lines[state.pos];
  if (line.text.slice(line.indent).startsWith('- ') || line.text.trim() === '-') {
    return parseSequence(state, indent);
  }
  return parseMap(state, indent);
}

function parseMap(state, indent) {
  const out = {};
  while (true) {
    skipBlank(state);
    if (state.pos >= state.lines.length) break;
    const line = state.lines[state.pos];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new Error(`YAML: unexpected indentation at line ${line.idx + 2}: "${line.text.trim()}"`);
    }
    const body = line.text.slice(indent);
    const m = body.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:#][^:]*?)\s*:(?:\s+(.*))?$/);
    if (!m) {
      throw new Error(`YAML: expected "key: value" at line ${line.idx + 2}: "${line.text.trim()}"`);
    }
    const key = unquoteKey(m[1].trim());
    const rest = (m[2] ?? '').trim();
    state.pos++;
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      throw new Error(`YAML: duplicate key "${key}" at line ${line.idx + 2}`);
    }
    out[key] = parseValueAfterKey(state, indent, rest, line);
  }
  return out;
}

function parseSequence(state, indent) {
  const out = [];
  while (true) {
    skipBlank(state);
    if (state.pos >= state.lines.length) break;
    const line = state.lines[state.pos];
    if (line.indent < indent) break;
    const body = line.text.slice(indent);
    if (line.indent !== indent || !(body.startsWith('- ') || body.trim() === '-')) break;
    const rest = body.trim() === '-' ? '' : body.slice(2).trim();
    state.pos++;
    if (rest === '') {
      skipBlank(state);
      const next = state.lines[state.pos];
      out.push(next && next.indent > indent ? parseNode(state, next.indent) : null);
    } else if (/^[^"'\[{][^:]*:(\s|$)/.test(rest) || /^("[^"]*"|'[^']*')\s*:(\s|$)/.test(rest)) {
      // "- key: value" starts an inline map; its siblings are indented past the dash.
      const childIndent = indent + 2;
      const synthetic = { text: ' '.repeat(childIndent) + rest, idx: line.idx, indent: childIndent };
      state.lines.splice(state.pos, 0, synthetic);
      out.push(parseMap(state, childIndent));
    } else {
      out.push(parseInlineScalar(state, indent, rest, line));
    }
  }
  return out;
}

function parseValueAfterKey(state, indent, rest, line) {
  if (rest === '' ) {
    skipBlank(state);
    const next = state.lines[state.pos];
    if (!next) return null;
    if (next.indent > indent) {
      const content = next.text.slice(next.indent);
      const looksStructured = content.startsWith('- ') || content === '-' ||
        /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:#"'\[{][^:]*?)\s*:(\s|$)/.test(content);
      if (looksStructured) return parseNode(state, next.indent);
      // A scalar that starts on the line after its key.
      state.pos++;
      return parseInlineScalar(state, indent, content.trim(), next);
    }
    // "key:" followed by a sequence at the same indent is valid YAML.
    if (next.indent === indent && next.text.slice(indent).startsWith('- ')) return parseSequence(state, indent);
    return null;
  }
  const block = rest.match(/^([|>])([+-]?)(\d*)\s*(#.*)?$/);
  if (block) return parseBlockScalar(state, indent, block[1], block[2]);
  return parseInlineScalar(state, indent, rest, line);
}

function parseInlineScalar(state, indent, rest, line) {
  if (rest.startsWith('"')) return parseDoubleQuoted(state, rest, line);
  if (rest.startsWith("'")) return parseSingleQuoted(state, rest, line);
  if (rest.startsWith('[')) return parseFlow(collectFlow(state, rest, '[', ']'), line);
  if (rest.startsWith('{')) return parseFlow(collectFlow(state, rest, '{', '}'), line);
  // Plain scalar, possibly continued on more-indented lines.
  let value = stripInlineComment(rest);
  while (state.pos < state.lines.length) {
    const next = state.lines[state.pos];
    if (next.text.trim() === '') {
      // A blank line inside a multi-line plain scalar becomes a newline.
      const after = state.lines.slice(state.pos + 1).find(l => l.text.trim() !== '');
      if (after && after.indent > indent && !isKeyLine(after, indent)) {
        value += '\n';
        state.pos++;
        continue;
      }
      break;
    }
    if (next.indent <= indent || next.text.trim().startsWith('#')) break;
    value += (value.endsWith('\n') ? '' : ' ') + stripInlineComment(next.text.trim());
    state.pos++;
  }
  return typedScalar(value.trim());
}

function isKeyLine(line, indent) {
  return line.indent === indent && /^[^:#]+:(\s|$)/.test(line.text.slice(indent));
}

function stripInlineComment(s) {
  const i = s.search(/\s#/);
  return i === -1 ? s : s.slice(0, i).trimEnd();
}

function typedScalar(v) {
  if (v === '' ) return '';
  if (/^(true|True|TRUE)$/.test(v)) return true;
  if (/^(false|False|FALSE)$/.test(v)) return false;
  if (/^(null|Null|NULL|~)$/.test(v)) return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  return v;
}

function parseDoubleQuoted(state, rest, line) {
  let text = rest;
  while (!closesDouble(text) && state.pos < state.lines.length) {
    text += '\n' + state.lines[state.pos].text.trim();
    state.pos++;
  }
  const end = closesDouble(text);
  if (!end) throw new Error(`YAML: unterminated double-quoted string at line ${line.idx + 2}`);
  const inner = text.slice(1, end - 1).replace(/\s*\n\s*/g, ' ');
  return inner.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => {
    if (c[0] === 'u') return String.fromCharCode(parseInt(c.slice(1), 16));
    return ({ n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/', r: '\r', '0': '\0' })[c] ?? c;
  });
}

function closesDouble(text) {
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '"') return i + 1;
  }
  return 0;
}

function parseSingleQuoted(state, rest, line) {
  let text = rest;
  const closes = t => {
    for (let i = 1; i < t.length; i++) {
      if (t[i] === "'") {
        if (t[i + 1] === "'") { i++; continue; }
        return i + 1;
      }
    }
    return 0;
  };
  while (!closes(text) && state.pos < state.lines.length) {
    text += '\n' + state.lines[state.pos].text.trim();
    state.pos++;
  }
  const end = closes(text);
  if (!end) throw new Error(`YAML: unterminated single-quoted string at line ${line.idx + 2}`);
  return text.slice(1, end - 1).replace(/''/g, "'").replace(/\s*\n\s*/g, ' ');
}

function collectFlow(state, rest, open, close) {
  let text = rest;
  const balanced = t => {
    let depth = 0, q = null;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') { depth--; if (depth === 0) return true; }
    }
    return false;
  };
  while (!balanced(text) && state.pos < state.lines.length) {
    text += ' ' + state.lines[state.pos].text.trim();
    state.pos++;
  }
  return text;
}

function parseFlow(text, line) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const value = () => {
    ws();
    if (text[i] === '[') {
      i++; const arr = [];
      ws();
      if (text[i] === ']') { i++; return arr; }
      while (i < text.length) {
        arr.push(value()); ws();
        if (text[i] === ',') { i++; ws(); if (text[i] === ']') { i++; return arr; } continue; }
        if (text[i] === ']') { i++; return arr; }
        throw new Error(`YAML: bad flow sequence at line ${line.idx + 2}`);
      }
      throw new Error(`YAML: unterminated flow sequence at line ${line.idx + 2}`);
    }
    if (text[i] === '{') {
      i++; const obj = {};
      ws();
      if (text[i] === '}') { i++; return obj; }
      while (i < text.length) {
        const k = scalar([':']); ws();
        if (text[i] !== ':') throw new Error(`YAML: bad flow map at line ${line.idx + 2}`);
        i++;
        obj[k] = value(); ws();
        if (text[i] === ',') { i++; ws(); if (text[i] === '}') { i++; return obj; } continue; }
        if (text[i] === '}') { i++; return obj; }
        throw new Error(`YAML: bad flow map at line ${line.idx + 2}`);
      }
      throw new Error(`YAML: unterminated flow map at line ${line.idx + 2}`);
    }
    return typedScalar(scalar([',', ']', '}']));
  };
  const scalar = stops => {
    ws();
    const q = text[i];
    if (q === '"' || q === "'") {
      i++; let s = '';
      while (i < text.length && text[i] !== q) {
        if (q === '"' && text[i] === '\\') { s += text[i + 1]; i += 2; continue; }
        if (q === "'" && text[i] === "'" && text[i + 1] === "'") { s += "'"; i += 2; continue; }
        s += text[i++];
      }
      i++;
      return s;
    }
    let s = '';
    while (i < text.length && !stops.includes(text[i])) s += text[i++];
    return s.trim();
  };
  const v = value();
  return v;
}

function parseBlockScalar(state, indent, style, chomp) {
  const collected = [];
  let blockIndent = null;
  while (state.pos < state.lines.length) {
    const line = state.lines[state.pos];
    if (line.text.trim() === '') { collected.push(''); state.pos++; continue; }
    if (blockIndent === null) {
      if (line.indent <= indent) break;
      blockIndent = line.indent;
    }
    if (line.indent < blockIndent) break;
    collected.push(line.text.slice(blockIndent));
    state.pos++;
  }
  // Trailing blank lines are governed by chomping.
  let trailing = 0;
  while (collected.length && collected[collected.length - 1] === '') { collected.pop(); trailing++; }
  let text;
  if (style === '|') {
    text = collected.join('\n');
  } else {
    // Folded: single newlines become spaces, blank lines become newlines,
    // more-indented lines keep their breaks.
    text = '';
    for (let i = 0; i < collected.length; i++) {
      const cur = collected[i];
      if (i === 0) { text = cur; continue; }
      const prev = collected[i - 1];
      if (cur === '') { text += '\n'; continue; }
      if (prev === '' || /^\s/.test(cur) || /^\s/.test(prev)) text += (prev === '' ? '' : '\n') + cur;
      else text += ' ' + cur;
    }
  }
  if (chomp === '-') return text;
  if (chomp === '+') return text + '\n'.repeat(trailing + 1);
  return text + (collected.length ? '\n' : '');
}

function unquoteKey(k) {
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) return k.slice(1, -1);
  return k;
}
