import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentRegistry, gradeContentQuestion } from '../src/content/catalog.js';

// Synthetic structural fixtures only. These are not JEE questions and are
// never packaged as reviewed educational content or authentic exam evidence.
function fixture() {
  const sourceUrl = 'https://example.invalid/synthetic-paper.pdf';
  const review = () => ({ reviewer: 'Synthetic test fixture only', reviewedAt: '2026-11-11', sourceUrl });
  const archive = { version: 1, checkedAt: '2026-11-11', sources: [{ id: 'fixture-source', title: 'Synthetic source fixture; not an exam source', url: 'https://example.invalid/', authority: 'official', notes: 'For validator unit tests only.' }], papers: [{ id: 'fixture-paper', year: 2015, exam: 'jee-advanced', label: 'Synthetic test paper, not an actual JEE paper', subject: 'all', paper: 1, sourceId: 'fixture-source', url: sourceUrl, sourceUrl: 'https://example.invalid/', verification: 'link-observed', coverage: 'full-paper', questionCount: 3, durationMinutes: 180, maxMarks: 12, transcriptionStatus: 'source-linked' }] };
  const options = () => ['A','B','C','D'].map(id => ({ id, text: `Synthetic option ${id}` }));
  const subjects = ['physics','chemistry','mathematics'];
  const chapters = ['phy-kinematics','chem-mole','math-probability'];
  const questions = subjects.map((subject, i) => ({ id: `fixture-q${i+1}`, paperId: 'fixture-paper', year: 2015, exam: 'jee-advanced', subject, section: `section-${i+1}`, questionNumber: String(i+1), source: { url: sourceUrl, page: i+1 }, statement: `Synthetic statement ${i+1}; not a real previous-year question.`, answer: { type: i===0?'single-choice':i===1?'numeric':'multiple-choice', value: i===0?'B':i===1?'2.5':['A','B','C'] }, marking: { correct: 4, incorrect: i===1?0:-2, unanswered: 0 }, review: { transcript:review(),answer:review(),marking:review() }, status: 'practice-ready', chapters:[chapters[i]], chapterReview:review(), solution:{steps:['Synthetic solution step for a schema test.'],sourceUrl:'https://example.invalid/synthetic-solutions',review:review()}, assets:[] }));
  questions[0].options = options(); questions[2].options = options();
  questions[2].marking.partialCredits = [
    {selected:['A'],marks:1},{selected:['B'],marks:1},{selected:['C'],marks:1},
    {selected:['A','B'],marks:2},{selected:['A','C'],marks:2},{selected:['B','C'],marks:2},
  ];
  const papers = [{ paperId:'fixture-paper',durationMinutes:180,expectedQuestionCount:3,maxMarks:12,review:review(),sections:questions.map((q,i)=>({id:q.section,title:`Synthetic section ${i+1}`,subject:q.subject,type:i===0?'single':i===1?'numerical':'multiple',questionIds:[q.id],marking:{correct:4,incorrect:i===1?0:-2,unanswered:0,...(i===2?{partialCreditRules:[{totalCorrect:3,selectedCorrect:1,marks:1},{totalCorrect:3,selectedCorrect:2,marks:2}]}:{})},source:{url:sourceUrl,page:i+1},review:review()})) }];
  return { archive, bundles:[{version:1,questions}], papers, availableAssets:[] };
}

test('empty runtime contains no invented questions and cannot unlock a paper', () => {
  const f=fixture(); const registry=createContentRegistry({archive:f.archive});
  assert.equal(registry.size,0); assert.deepEqual(registry.filterQuestions(),[]);
  assert.deepEqual(registry.listPapers(),[]);
  assert.equal(registry.getPaper('fixture-paper').complete,false);
  assert.throws(()=>registry.getFullPaper('fixture-paper'),/not ready/);
  assert.throws(()=>registry.getQuestion('fixture-q1'),/Unknown reviewed/);
});

test('reviewed runtime resolves stable immutable questions and composes filters', () => {
  const f=fixture(); const registry=createContentRegistry(f);
  assert.equal(registry.size,3);
  const q=registry.getQuestion('fixture-q1');
  assert.equal(q.id,'fixture-q1');assert.equal(q.origin,'pyq');assert.equal(q.type,'single');
  assert.equal(q.chapter,'phy-kinematics');assert.equal(q.stem,f.bundles[0].questions[0].statement);
  assert.equal(q.source.page,1);assert.equal(q.solution.length,1);assert.equal(q.answer,'B');
  assert.deepEqual(registry.filterQuestions({year:'2015',subject:'physics',chapter:'phy-kinematics',type:'single',paperId:'fixture-paper',paper:1}).map(q=>q.id),['fixture-q1']);
  assert.equal(registry.filterQuestions({year:2014}).length,0);
  assert.equal(registry.filterQuestions({fromYear:2010,toYear:2016}).length,3);
  assert.throws(()=>{q.answer='A';},TypeError);
  assert.throws(()=>{q.options[0].text='mutated';},TypeError);
  assert.throws(()=>{q.solution.push('forged');},TypeError);
  f.bundles[0].questions[0].statement='changed outside registry';
  f.archive.papers[0].durationMinutes=1;
  assert.notEqual(q.stem,'changed outside registry');assert.equal(registry.getFullPaper('fixture-paper').durationMinutes,180);
});

test('all transcript, chapter, answer, marking and solution reviews remain mandatory', () => {
  for(const mutate of [
    q=>{delete q.review.transcript;},q=>{delete q.review.answer;},q=>{delete q.review.marking;},
    q=>{delete q.chapterReview;},q=>{delete q.solution;},q=>{delete q.solution.review;},
    q=>{q.solution.review.reviewer='';},q=>{q.status='source-imported';},q=>{q.solution.steps=[];},
    q=>{q.chapters=['chem-mole'];},q=>{q.review.answer.reviewedAt='2026-02-30';},
  ]) {const f=fixture();mutate(f.bundles[0].questions[0]);assert.throws(()=>createContentRegistry(f),/validation failed/i);}
});

test('duplicate content IDs and source question identities across bundles are refused', () => {
  const f=fixture();f.bundles.push({version:1,questions:[structuredClone(f.bundles[0].questions[0])]});
  assert.throws(()=>createContentRegistry(f),/duplicate ID/);
  f.bundles[1].questions[0].id='different-id';
  assert.throws(()=>createContentRegistry(f),/duplicate source question identity/);
});

test('assets must be safe, attributed, accessible through the supplied build inventory, and described', () => {
  const f=fixture();f.bundles[0].questions[0].assets=[{id:'figure-1',url:'assets/content/fixture-diagram.svg',alt:'Synthetic diagram used only by the validator test.',role:'statement',sourceUrl:'https://example.invalid/synthetic-paper.pdf'}];
  assert.throws(()=>createContentRegistry(f),/absent from the verified build inventory/);
  f.availableAssets=['assets/content/fixture-diagram.svg'];
  const q=createContentRegistry(f).getQuestion('fixture-q1');assert.equal(q.assets[0].url,f.availableAssets[0]);
  for(const url of ['javascript:alert(1)','assets/content/../../private.png','http://example.invalid/a.png','https://user:pass@example.invalid/a.png']) {
    const bad=structuredClone(f);bad.bundles[0].questions[0].assets[0].url=url;bad.availableAssets=[url];assert.throws(()=>createContentRegistry(bad));
  }
  const missingAlt=structuredClone(f);missingAlt.bundles[0].questions[0].assets[0].alt='';assert.throws(()=>createContentRegistry(missingAlt),/alternative text/);
  const wrongOption=structuredClone(f);Object.assign(wrongOption.bundles[0].questions[0].assets[0],{role:'option',optionId:'X'});assert.throws(()=>createContentRegistry(wrongOption),/optionId/);
});

test('historical marking uses exact keys, explicit partial subsets, negatives and unanswered zero', () => {
  const registry=createContentRegistry(fixture());
  const single=registry.getQuestion('fixture-q1'),numeric=registry.getQuestion('fixture-q2'),multiple=registry.getQuestion('fixture-q3');
  assert.deepEqual(gradeContentQuestion(single,'B'),{score:4,maxScore:4,status:'correct'});
  assert.equal(gradeContentQuestion(single,'A').score,-2);
  assert.equal(gradeContentQuestion(single,'').status,'skipped');
  assert.equal(gradeContentQuestion(numeric,'5/2').status,'correct');
  assert.equal(gradeContentQuestion(numeric,'2.5000000000000001').status,'incorrect');
  assert.equal(gradeContentQuestion(numeric,'1/0').status,'incorrect');
  assert.equal(gradeContentQuestion(multiple,['C','A','B']).score,4);
  assert.deepEqual(gradeContentQuestion(multiple,['C','A']),{score:2,maxScore:4,status:'partial'});
  assert.equal(gradeContentQuestion(multiple,['A','D']).score,-2);
  assert.equal(gradeContentQuestion(multiple,['A','A']).score,-2);
  assert.equal(gradeContentQuestion(multiple,[]).score,0);
});

test('numeric accepted ranges are inclusive exact rationals, not floating-point tolerances', () => {
  const f=fixture();f.bundles[0].questions[1].answer.acceptedRange=['2.49','2.51'];
  const q=createContentRegistry(f).getQuestion('fixture-q2');
  for(const answer of ['2.49','2.51','249/100','251/100','2.5'])assert.equal(gradeContentQuestion(q,answer).status,'correct');
  for(const answer of ['2.4899999999999999','2.5100000000000001','NaN','2e0'])assert.equal(gradeContentQuestion(q,answer).status,'incorrect');
  const rounded=fixture();rounded.bundles[0].questions[1].answer={type:'numeric',value:'9007199254740992',acceptedRange:['9007199254740993','9007199254740992']};
  assert.throws(()=>createContentRegistry(rounded),/exact bounds/);
});

test('discrete numerical alternatives never become a continuous accepted range', () => {
  const f=fixture();f.bundles[0].questions[1].answer={type:'numeric',value:'80',acceptedValues:['80','150','220']};
  const q=createContentRegistry(f).getQuestion('fixture-q2');
  for(const response of ['80','150','220','300/2'])assert.equal(gradeContentQuestion(q,response).status,'correct');
  for(const response of ['81','100','149.9999999999999','219','221'])assert.equal(gradeContentQuestion(q,response).status,'incorrect');
  const range=structuredClone(f);range.bundles[0].questions[1].answer.acceptedRange=['80','220'];assert.throws(()=>createContentRegistry(range),/without a continuous range/);
  const duplicate=structuredClone(f);duplicate.bundles[0].questions[1].answer.acceptedValues.push('80.0');assert.throws(()=>createContentRegistry(duplicate),/duplicate numerical alternative/);
});

test('matching lists preserve labels, source order and LaTeX without destructive unescaping', () => {
  const f=fixture();const lists={left:[{label:'P',text:'\\frac{1}{2}'},{label:'Q',text:'\\begin{matrix}1 \\\\ 2\\end{matrix}'}],right:[{label:'1',text:'First entry'},{label:'2',text:'Second entry'}]};
  f.bundles[0].questions[0].matchingLists=lists;
  const q=createContentRegistry(f).getQuestion('fixture-q1');assert.deepEqual(q.matchingLists,lists);assert.ok(Object.isFrozen(q.matchingLists.left[0]));
  const duplicate=structuredClone(f);duplicate.bundles[0].questions[0].matchingLists.left[1].label='P';assert.throws(()=>createContentRegistry(duplicate),/labels must be distinct/);
});

test('official bonus records award unconditional marks without inflating correctness', () => {
  const f=fixture();const raw=f.bundles[0].questions[1];raw.answer={type:'bonus',value:null};raw.marking={correct:4,incorrect:4,unanswered:4};
  const registry=createContentRegistry(f),q=registry.getQuestion(raw.id);
  assert.equal(q.type,'bonus');assert.equal(q.answer,null);assert.equal(registry.getFullPaper('fixture-paper').complete,true);
  for(const answer of ['',[],null,'nonsense'])assert.deepEqual(gradeContentQuestion(q,answer),{score:4,maxScore:4,status:'bonus'});
  const foreign=structuredClone(f);foreign.bundles[0].questions[1].review.answer.sourceUrl='https://other.invalid/key';assert.throws(()=>createContentRegistry(foreign),/official answer-key evidence/);
  const guessed=structuredClone(f);guessed.bundles[0].questions[1].marking.unanswered=0;assert.throws(()=>createContentRegistry(guessed),/same positive marks/);
});

test('a bonus extension cannot bypass source identity validation for its bundle', () => {
  const f=fixture();f.bundles[0].questions[1].answer={type:'bonus',value:null};f.bundles[0].questions[1].marking={correct:4,incorrect:4,unanswered:4};
  f.bundles[0].questions[0].source.url='https://foreign.invalid/unrelated.pdf';
  assert.throws(()=>createContentRegistry(f),/must resolve to the catalog/);
  const mismatch=fixture();mismatch.bundles[0].questions[0].year=2014;assert.throws(()=>createContentRegistry(mismatch),/exam identity/);
});

test('full-paper mocks preserve reviewed duration, section order and grading rules', () => {
  const registry=createContentRegistry(fixture());const paper=registry.getFullPaper('fixture-paper');
  assert.equal(paper.status,'ready');assert.equal(paper.durationMinutes,180);assert.equal(paper.maxMarks,12);
  assert.deepEqual(paper.questions.map(q=>q.id),['fixture-q1','fixture-q2','fixture-q3']);
  assert.deepEqual(paper.sections.map(section=>section.subject),['physics','chemistry','mathematics']);
  assert.equal(paper.sections[2].marking.partialCreditRules.length,2);
  assert.throws(()=>paper.orderedQuestionIds.reverse(),TypeError);
});

test('missing questions, unknown source totals, partial sources and wrong section rules keep mocks closed', () => {
  const cases=[
    f=>{f.bundles[0].questions.pop();},
    f=>{f.archive.papers[0].questionCount=null;},
    f=>{f.archive.papers[0].maxMarks=null;},
    f=>{f.archive.papers[0].coverage='partial-collection';},
    f=>{f.papers[0].durationMinutes=170;},
    f=>{f.papers[0].sections[0].type='numerical';},
    f=>{f.papers[0].sections[0].marking.incorrect=-1;},
    f=>{f.papers[0].sections[2].marking.partialCreditRules.pop();},
    f=>{f.papers[0].sections[2].source.url='https://other.invalid/instructions';},
  ];
  for(const mutate of cases) {const f=fixture();mutate(f);const registry=createContentRegistry(f);assert.equal(registry.getPaper('fixture-paper').status,'incomplete');assert.throws(()=>registry.getFullPaper('fixture-paper'),/not ready/);}
});

test('full mocks refuse duplicate ordered questions and do not fill missing subjects with generated items', () => {
  const duplicate=fixture();duplicate.papers[0].sections[1].questionIds=['fixture-q1'];assert.throws(()=>createContentRegistry(duplicate),/occurs twice/);
  const f=fixture();f.papers[0].sections.pop();f.papers[0].expectedQuestionCount=2;f.papers[0].maxMarks=8;f.archive.papers[0].questionCount=2;f.archive.papers[0].maxMarks=8;f.bundles[0].questions.pop();
  const registry=createContentRegistry(f);assert.equal(registry.size,2);assert.equal(registry.getPaper('fixture-paper').complete,false);assert.match(registry.getPaper('fixture-paper').reasons.join(' '),/Physics, Chemistry and Mathematics/);
});
