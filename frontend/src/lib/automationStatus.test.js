import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automationStatus, runtimePresentation, contactWindowLabel, conversationAutomationLabel } from './automationStatus.js';
const settings={enabled:true,lastRunAt:'2026-09-09T12:00:00Z'};
const runtime={outboundEnabled:true,autoRepliesEnabled:true,automationEnabled:true,channelConfigured:true};
test('failed settings never become disabled or functioning',()=>{
 assert.equal(automationStatus({settings,failed:true,runtime}).label,'Sin verificar');
 assert.equal(automationStatus({settings,runtime:null}).label,'Envíos sin verificar');
});
test('an enabled rule respects global pause, quiet hours and errors',()=>{
 assert.equal(automationStatus({settings,runtime:{...runtime,outboundEnabled:false}}).label,'Pausada por el equipo');
 assert.equal(automationStatus({settings,runtime:{...runtime,quietHoursPaused:true}}).label,'Esperando horario');
 assert.equal(automationStatus({settings:{...settings,lastError:'invalid template'},runtime}).label,'Requiere revisión');
 assert.equal(automationStatus({settings,runtime}).label,'Habilitada para ejecutar');
});
test('runtime unavailable is unknown, not zero or healthy',()=>{
 assert.equal(runtimePresentation(null).title,'Estado de envíos sin verificar');
 assert.equal(runtimePresentation({}).title,'Estado de envíos sin verificar');
 assert.equal(automationStatus({settings,runtime:{}}).label,'Envíos sin verificar');
 assert.equal(conversationAutomationLabel({aiEnabled:true},{}),'IA · permisos sin verificar');
 assert.equal(contactWindowLabel(null),'Horario sin verificar');
 assert.match(contactWindowLabel({quietHours:{startHour:21,endHour:9,timezone:'Argentina'}}),/21:00 a 09:00/);
});
test('conversation assignment does not claim active delivery',()=>{
 assert.equal(conversationAutomationLabel({aiEnabled:true,queue:'HUMAN'},runtime),'Equipo humano');
 assert.equal(conversationAutomationLabel({aiEnabled:true},null),'IA · permisos sin verificar');
 assert.equal(conversationAutomationLabel({aiEnabled:true},{...runtime,autoRepliesEnabled:false}),'IA · envíos pausados');
 assert.equal(conversationAutomationLabel({aiEnabled:true},runtime),'Asignada a IA');
});
