import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const appConsoleCheck = {
  label: 'app console usage',
  dir: 'src',
  extensions: new Set(['.ts', '.vue']),
  skip: file => file.includes(`${path.sep}test${path.sep}`) || file.endsWith('.spec.ts'),
  patterns: [/console\.(log|warn|error|debug|info)\s*\(/],
};

const sidecarConsoleCheck = {
  label: 'sidecar console usage',
  dir: 'sidecar',
  extensions: new Set(['.ts']),
  skip: skipSidecarBuildOutput,
  patterns: [/console\.(log|warn|error|debug|info)\s*\(/],
};

for (const check of [appConsoleCheck, sidecarConsoleCheck]) {
  scanLinePatterns(check);
}

scanSidecarStdout();
scanFrontendLogStatements();
scanRustLogStatements();

if (failures.length > 0) {
  console.error('Logging guard check failed:\n' + failures.join('\n'));
  process.exit(1);
}

function scanLinePatterns(check) {
  const base = path.join(root, check.dir);
  if (!fs.existsSync(base)) return;

  for (const file of walk(base)) {
    if (!check.extensions.has(path.extname(file))) continue;
    if (check.skip(file)) continue;

    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (isCommentLine(trimmed)) return;
      if (check.patterns.some(pattern => pattern.test(line))) {
        failures.push(`${check.label}: ${path.relative(root, file)}:${index + 1}: ${trimmed}`);
      }
    });
  }
}

function scanSidecarStdout() {
  const base = path.join(root, 'sidecar');
  if (!fs.existsSync(base)) return;

  for (const file of walk(base)) {
    if (path.extname(file) !== '.ts') continue;
    if (skipSidecarBuildOutput(file)) continue;
    if (path.basename(file) === 'diagnostic-logger.ts') continue;

    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (isCommentLine(trimmed)) return;
      if (/process\.(stdout|stderr)\.write\s*\(/.test(line)) {
        failures.push(`sidecar raw stdio output: ${path.relative(root, file)}:${index + 1}: ${trimmed}`);
      }
    });
  }
}

function scanFrontendLogStatements() {
  for (const dir of ['src', 'sidecar']) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;

    for (const file of walk(base)) {
      if (!new Set(['.ts', '.vue']).has(path.extname(file))) continue;
      if (dir === 'src' && (file.includes(`${path.sep}test${path.sep}`) || file.endsWith('.spec.ts'))) continue;
      if (dir === 'sidecar' && skipSidecarBuildOutput(file)) continue;

      const content = fs.readFileSync(file, 'utf8');
      for (const statement of collectCallStatements(content, /\b(?:log|logger)\.(?:debug|info|warn|error)\s*\(/g)) {
        const stripped = normalizeLogStatement(statement.text);
        if (hasRawFrontendPayload(stripped)) {
          failures.push(`frontend raw log payload: ${path.relative(root, file)}:${statement.line}: ${oneLine(statement.text)}`);
        }
      }
    }
  }
}

function scanRustLogStatements() {
  const base = path.join(root, 'src-tauri', 'src');
  if (!fs.existsSync(base)) return;

  for (const file of walk(base)) {
    if (path.extname(file) !== '.rs') continue;

    const content = fs.readFileSync(file, 'utf8');
    for (const statement of collectCallStatements(content, /\blog::(?:debug|info|warn|error)!\s*\(/g)) {
      const stripped = normalizeLogStatement(statement.text);
      if (hasRawRustPayload(stripped)) {
        failures.push(`rust raw log payload: ${path.relative(root, file)}:${statement.line}: ${oneLine(statement.text)}`);
      }
    }
  }
}

function hasRawFrontendPayload(statement) {
  let normalized = statement
    .replace(/\b(?:safeStringify|redactForLog|sanitizeText|sanitizeUrl|sanitizePath)\s*\([^)]*\)/g, '')
    .replace(/\b\w+(?:\?\.|\.)length\b/g, '')
    .replace(/\b\w+\.substring\s*\(\s*0\s*,\s*\d+\s*\)/g, 'rawPreview');

  if (/\b(rawResponse|responseText|responseBody|rawBody)\b/i.test(normalized)) return true;
  if (/\b(content|body|payload)\.substring\s*\(/i.test(normalized)) return true;
  if (/\b(headers?|Authorization|Cookie)\b\s*[:=]\s*[^,}\n]+/i.test(normalized)) return true;
  if (/\b(cookie|token|authToken|authorization|accessKey|secretKey|password)\b(?!\s*(?:\?\.)?\.length\b)/i.test(normalized)) {
    return true;
  }

  return false;
}

function hasRawRustPayload(statement) {
  const normalized = statement
    .replace(/\bsummarize_text\s*\([^)]*\)/g, '')
    .replace(/\bsanitize_[a-zA-Z_]+\s*\([^)]*\)/g, '')
    .replace(/\bsafe_(?:url|path)\s*\([^)]*\)/g, '')
    .replace(/\b[a-zA-Z_][\w]*\.len\s*\(\s*\)/g, '')
    .replace(/\b[a-zA-Z_][\w]*\.is_empty\s*\(\s*\)/g, '')
    .replace(/\b[a-zA-Z_][\w]*\.status\.code\s*\(\s*\)/g, '');

  if (/\b(response_text|response_body|raw_response|raw_body|body|output|stdout|stderr)\b/i.test(normalized)) return true;
  if (/\b(cookie|merged_cookie|token|auth_token|authorization|authorization_header|access_key|access_key_id|secret_access_key|secret_key|password)\b/i.test(normalized)) {
    return true;
  }

  return false;
}

function collectCallStatements(content, startPattern) {
  const statements = [];
  const lines = content.split(/\r?\n/);
  let collecting = false;
  let startLine = 0;
  let buffer = '';
  let parenDepth = 0;

  lines.forEach((line, index) => {
    if (!collecting) {
      startPattern.lastIndex = 0;
      const match = startPattern.exec(line);
      if (!match) return;
      collecting = true;
      startLine = index + 1;
      buffer = line.slice(match.index);
      parenDepth = parenDelta(line.slice(match.index));
    } else {
      buffer += `\n${line}`;
      parenDepth += parenDelta(line);
    }

    if (collecting && parenDepth <= 0 && /[);]\s*$/.test(line.trim())) {
      statements.push({ line: startLine, text: buffer });
      collecting = false;
      startLine = 0;
      buffer = '';
      parenDepth = 0;
    }
  });

  return statements;
}

function normalizeLogStatement(statement) {
  return stripTemplateExpressions(stripStringLiterals(stripLineComments(statement)));
}

function stripLineComments(value) {
  return value
    .split(/\r?\n/)
    .map(line => {
      const commentIndex = line.indexOf('//');
      return commentIndex === -1 ? line : line.slice(0, commentIndex);
    })
    .join('\n');
}

function stripStringLiterals(value) {
  return value
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, template => {
      const expressions = [...template.matchAll(/\$\{([^}]*)\}/g)].map(match => match[1]);
      return expressions.length > 0 ? expressions.join(' ') : '``';
    })
    .replace(/"(?:\\[\s\S]|[^"\\])*"/g, '""')
    .replace(/'(?:\\[\s\S]|[^'\\])*'/g, "''");
}

function stripTemplateExpressions(value) {
  return value.replace(/\$\{[^}]*\}/g, '${}');
}

function parenDelta(value) {
  const stripped = stripStringLiterals(value);
  let delta = 0;
  for (const char of stripped) {
    if (char === '(') delta += 1;
    else if (char === ')') delta -= 1;
  }
  return delta;
}

function skipSidecarBuildOutput(file) {
  return file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}dist${path.sep}`);
}

function isCommentLine(trimmed) {
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function oneLine(value) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 220);
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}
