import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
for(const mode of ['hosted','packaged']){
 const {results}=read(`tests/webos/t34-runtime-${mode}.json`),states=results.slice(0,4).map(r=>r.state);
 assert.equal(states[0].hash,'#/settings');assert.equal(states[1].hash,'#/addons?addon=https%3A%2F%2Faddon.example%2Fmanifest.json');
 assert.equal(states[2].hash,states[1].hash);assert.equal(states[3].hash,states[1].hash);
 assert(states.every(s=>s.boot===states[0].boot && s.history===states[0].history));
 if(mode==='packaged')for(const enabled of [true,false]){
  const before=results.find(r=>r.label==='before-hide-'+enabled).state,hidden=results.find(r=>r.label==='hidden-'+enabled).state,back=results.find(r=>r.label==='return-'+enabled).state;
  assert.equal(before.video.paused,false);assert.equal(hidden.hidden,true);assert.equal(back.hidden,false);
  assert.equal(hidden.video.paused,enabled);assert.equal(back.video.paused,enabled);
  assert.equal(hidden.fixture.pauses-before.fixture.pauses,enabled?1:0);assert.equal(back.fixture.pauses,hidden.fixture.pauses);
 }
}
assert.equal(read('tests/webos/t34-cold-launch.json').passed,true);
assert(read('tests/webos/t34-checks.json').checks.every(c=>c.exitCode===0));
const files=['src/common/Platform/webos/adapter.ts','src/common/Platform/webos/useWebOS.ts','src/common/parseDeepLink.js','src/App/App.js','src/routes/Player/Player.js','tests/webosLifecycle.spec.js'];
const hashes=Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
fs.writeFileSync('tests/webos/t34-summary.json',JSON.stringify({date:new Date().toISOString(),checksPassed:true,hostedRelaunchPassed:true,packagedFixturePassed:true,coldLaunchFixturePassed:true,fullPlayerHostedValidated:false,fullAppPackagedValidated:false,physicalTVValidated:false,hashes},null,2));
console.log('PASS: checks, hosted routes, packaged fixture routes/visibility/pause, cold launch');
