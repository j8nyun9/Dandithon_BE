import test from 'node:test';
import assert from 'node:assert/strict';
import {participationTotals} from '../src/modules/league/participation.js';
test('승인된 활동 한 건은 기여량 설정과 관계없이 1단위, 복합 분야에는 분할',()=>{const actual=participationTotals([{status:'approved',weights:{volunteer:1},contribution_value:8},{status:'approved',weights:{mentoring:.5,scholarship:.5},contribution_value:3},{status:'pending',weights:{volunteer:1}},{status:'cancelled',weights:{volunteer:1}}]);assert.equal(actual.completed,2);assert.equal(actual.axes.volunteer,1);assert.equal(actual.axes.mentoring,.5);assert.equal(actual.axes.scholarship,.5);});
test('실제 헌혈만의 활동은 미확정 정책에 따라 제외',()=>{assert.equal(participationTotals([{status:'approved',weights:{blood:1},is_demo:false}]).completed,0);});
