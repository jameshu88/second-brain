const yaml = require('js-yaml');

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split a document into raw frontmatter text and body without parsing.
 * Useful when you want to preserve exact YAML formatting.
 */
function splitDocument(text) {
  const m = text.match(FENCE);
  if (!m) {
    return { frontmatterText: '', body: text };
  }
  return { frontmatterText: m[1], body: text.slice(m[0].length) };
}

/**
 * Parse a markdown document into frontmatter object + body string.
 * If there's no fenced YAML at the top, frontmatter is `{}`.
 */
function parse(text) {
  const { frontmatterText, body } = splitDocument(text);
  if (frontmatterText === '') {
    return { frontmatter: {}, body };
  }
  const fm = yaml.load(frontmatterText, { schema: yaml.CORE_SCHEMA }) || {};
  if (typeof fm !== 'object' || Array.isArray(fm)) {
    throw new Error('frontmatter: top-level YAML must be a mapping');
  }
  return { frontmatter: fm, body };
}

/**
 * Merge override fields onto base. Override keys win; base keys not present
 * in override are preserved (including unknown ones we don't know about).
 */
function merge(base, override) {
  return { ...base, ...override };
}

/**
 * Serialize a frontmatter object + body back into a fenced markdown document.
 * Uses js-yaml with stable key order (insertion order) and `noRefs` for safety.
 */
function serialize(frontmatter, body) {
  const yamlText = yaml
    .dump(frontmatter, { noRefs: true, lineWidth: 1000, sortKeys: false, schema: yaml.CORE_SCHEMA })
    .trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}

module.exports = { parse, merge, serialize, splitDocument };
