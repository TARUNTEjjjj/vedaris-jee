import katex from './vendor/katex.mjs';
import './vendor/contrib/mhchem.mjs';

export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Compile at publication time. Native MathML keeps the client dependency-free. */
export function renderStudyText(value){
  const text=String(value??''), pattern=/\$\$[\s\S]*?\$\$|\$(?:[^$]|\\\$)*?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g;
  let html='',cursor=0;
  for(const match of text.matchAll(pattern)){
    html+=escapeHTML(text.slice(cursor,match.index)).replace(/\n/g,'<br>');
    const full=match[0],display=full.startsWith('$$')||full.startsWith('\\['),width=full.startsWith('$')?(display?2:1):2;
    html+=katex.renderToString(full.slice(width,-width),{output:'mathml',displayMode:display,throwOnError:true,trust:false,strict:'error',maxExpand:1000,maxSize:50});
    cursor=match.index+full.length;
  }
  html+=escapeHTML(text.slice(cursor)).replace(/\n/g,'<br>');
  return html;
}
