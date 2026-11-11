import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStudyText } from '../scripts/render-math.mjs';

test('publication renderer escapes prose and emits native accessible MathML',()=>{
 const html=renderStudyText('For <x> & y, $\\frac{a^2}{b}$\n[FIG_1]');
 assert.match(html,/&lt;x&gt; &amp; y/);
 assert.match(html,/<math xmlns="http:\/\/www.w3.org\/1998\/Math\/MathML"/);
 assert.match(html,/<mfrac>/);assert.match(html,/<msup>/);
 assert.match(html,/<br>\[FIG_1\]/);
 assert.doesNotMatch(html,/<x>|<script|<link|<img/);
});

test('all supported delimiters render and invalid mathematical markup fails publication',()=>{
 for(const expression of ['$x$','$$x$$','\\(x\\)','\\[x\\]'])assert.match(renderStudyText(expression),/<math /);
 assert.match(renderStudyText('$$x^2$$'),/display="block"/);
 assert.throws(()=>renderStudyText('$\\frac{1}{$'));
 assert.throws(()=>renderStudyText('$\\notARealCommand{x}$'));
});

test('chemical formulae and reaction arrows compile locally to MathML',()=>{
 const html=renderStudyText('$\\ce{NaOH}$ and $\\ce{SO4^2-}$ and $\\ce{A ->[heat] B}$');
 assert.equal((html.match(/<math /g)||[]).length,3);
 assert.match(html,/<msub/);assert.match(html,/<msup/);
 assert.doesNotMatch(html,/<script|<img|katex-error/);
});

test('untrusted prose and TeX cannot introduce executable HTML or remote dependencies',()=>{
 const prose=renderStudyText('<img src=x onerror="alert(1)"><script>alert(2)</script>');
 assert.doesNotMatch(prose,/<img|<script/);
 for(const tex of ['\\href{javascript:alert(1)}{click}','\\includegraphics{https://example.invalid/a.png}','\\htmlStyle{color:red}{x}']){
   try{const html=renderStudyText(`$${tex}$`);assert.doesNotMatch(html,/<a\b|<img\b|<script\b|style="color:red"/);}catch(error){assert.match(error.message,/KaTeX|ParseError/);}
 }
});
