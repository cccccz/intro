// Version-locked adapter: add source locations to existing HTML nodes without
// changing the parse tree, TeX input, math classes, or MathML accessibility tree.
export function instrumentKatex(source, version) {
  if (version !== '0.16.47') throw new Error('Review KaTeX source-map adapter before upgrading KaTeX');
  const replaceOnce = (from, to) => {
    if (source.split(from).length !== 2) throw new Error('KaTeX source-map patch no longer matches');
    source = source.replace(from, to);
  };
  replaceOnce('const buildGroup = function (group, options, baseOptions) {', `
let introSource = null;
function introChildLocation(group) {
  const locations = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.loc && value.loc.lexer.input === introSource) { locations.push(value.loc); return; }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const key of ['body', 'base', 'sup', 'sub', 'numer', 'denom', 'index']) visit(value[key]);
  }
  visit(group);
  return locations.length ? { lexer: locations[0].lexer, start: Math.min(...locations.map(l => l.start)), end: Math.max(...locations.map(l => l.end)) } : null;
}
function introMapNode(node, group) {
  const loc = group.introLoc || group.loc || introChildLocation(group);
  if (!loc || loc.lexer.input !== introSource || loc.end <= loc.start || node.introMapped) return;
  // Fragments have no outer element. Their children retain their own mappings.
  if (!(node instanceof SymbolNode) && !(node instanceof Span)) return;
  node.introMapped = true;
  const markup = node.toMarkup;
  const start = loc.start, end = loc.end;
  node.toMarkup = function () {
    const result = markup.call(this);
    const attrs = ' data-tex-start="' + start + '" data-tex-end="' + end + '"';
    return result.startsWith('<span') ? result.replace('<span', '<span' + attrs) : '<span' + attrs + '>' + result + '</span>';
  };
}
const buildGroup = function (group, options, baseOptions) {`);
  replaceOnce('let groupNode = _htmlGroupBuilders[group.type](group, options);',
    'let groupNode = _htmlGroupBuilders[group.type](group, options);\n    introMapNode(groupNode, group);');
  replaceOnce('const canCombine = (prev, next) => {',
    'const canCombine = (prev, next) => {\n  if (prev.introMapped || next.introMapped) return false;');
  replaceOnce('const renderToString = function (expression, options) {',
    'const renderToString = function (expression, options) {\n  introSource = expression;');
  replaceOnce('return this.callFunction(func, args, optArgs, token, breakOnTokenText);', `
    const result = this.callFunction(func, args, optArgs, token, breakOnTokenText);
    const next = this.fetch();
    if (token.loc && next.loc && token.loc.lexer.input === introSource && next.loc.lexer === token.loc.lexer) {
      result.introLoc = { lexer: token.loc.lexer, start: token.loc.start, end: next.loc.start };
    }
    return result;`);
  return source;
}
