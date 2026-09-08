import markdownit from 'markdown-it';
import katex from 'katex';
import { markupMarkdown, setMarkdownIt, hasMarkDelimiters } from '../electron/renderer/render.ts';

setMarkdownIt(markdownit);

export function validateAnswer(answer) {
  if (!answer || typeof answer.title !== 'string' || !answer.title.trim()
    || typeof answer.markdown !== 'string' || !answer.markdown.trim()
    || typeof answer.sourceId !== 'string') throw new Error('Invalid structured answer');
  if (hasMarkDelimiters(answer.markdown)) throw new Error('Answer contains internal rivet syntax');
  let formulas = 0;
  const html = markupMarkdown(answer.markdown, (tex, displayMode) => {
    formulas++;
    return katex.renderToString(tex, { displayMode, throwOnError: true, trust: false });
  });
  return { html, formulas };
}
