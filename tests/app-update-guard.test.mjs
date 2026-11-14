import test from 'node:test';
import assert from 'node:assert/strict';
import {canApplyAppUpdate} from '../assets/app-update-guard.js';
const idle={ready:true,writerMode:'writer',blockedCount:0,saveFailed:false,session:null,historicalWorkspace:null,historicalMemory:false,route:'overview'};
test('updates preserve active exams, notebook drafts and memory-only work',()=>{
 assert.equal(canApplyAppUpdate(idle),true);
 for(const change of [{ready:false},{writerMode:'memory'},{blockedCount:1},{saveFailed:true},
  {session:{finishedAt:null}},{historicalWorkspace:{active:{}}},{historicalMemory:true},
  ...['mistakes','bank','paper','practice','pyq'].map(route=>({route}))])
  assert.equal(canApplyAppUpdate({...idle,...change}),false,JSON.stringify(change));
 assert.equal(canApplyAppUpdate({...idle,session:{finishedAt:123},historicalWorkspace:{active:null}}),true);
});
