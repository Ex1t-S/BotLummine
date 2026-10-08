import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntimeStatusHandler } from '../src/controllers/runtime-status.controller.js';

test('runtime status uses authenticated workspace, only reads and never claims Meta connectivity', async t => {
 const scopes = [];
 const listFlags = async workspaceId => {
  scopes.push(workspaceId);
  return [{key:'whatsapp_outbound', enabled:false, reason:'Incident pause'}];
 };
 const db = {whatsAppChannel:{findFirst:async ({where,select}) => {
  scopes.push(where.workspaceId); assert.deepEqual(select,{id:true}); return {id:'channel-demo'};
 }}};
 const getRuntimeStatus = createRuntimeStatusHandler({db,listFlags});
 let payload; const headers = {};
 await getRuntimeStatus({user:{workspaceId:'workspace-a'},query:{workspaceId:'workspace-b'}}, {
  setHeader:(key,value)=>{headers[key]=value;}, json:value=>{payload=value;},
 }, error=>{throw error;});
 assert.deepEqual(scopes,['workspace-a','workspace-a']);
 assert.equal(payload.outboundEnabled,false);
 assert.equal(payload.channelConfigured,true);
 assert.equal(payload.connectivity,'UNVERIFIED');
 assert.equal(headers['Cache-Control'],'no-store');
 assert.ok(Number.isInteger(payload.quietHours.startHour));
 assert.equal(JSON.stringify(payload).includes('token'),false);
});

test('runtime status propagates unavailable database instead of reporting paused or zero', async t => {
 const getRuntimeStatus = createRuntimeStatusHandler({ listFlags: async()=>{throw new Error('offline');}, db:{whatsAppChannel:{findFirst:async()=>null}} });
 let error; let replied=false;
 await getRuntimeStatus({user:{workspaceId:'workspace-a'}},{json:()=>{replied=true;}},value=>{error=value;});
 assert.equal(error.message,'offline'); assert.equal(replied,false);
});

test('runtime status refuses unscoped requests before database reads', async t => {
 const read=t.mock.fn(async()=>{throw new Error('unexpected read');});
 const getRuntimeStatus = createRuntimeStatusHandler({listFlags:read,db:{}});
 let error;
 await getRuntimeStatus({user:{}},{},value=>{error=value;});
 assert.equal(error.status,400); assert.equal(read.mock.callCount(),0);
});
