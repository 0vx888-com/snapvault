const {expect}=require('chai');
const {readdirSync,readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const hre=require('hardhat');
const {TASK_TEST_GET_TEST_FILES}=require('hardhat/builtin-tasks/task-names');
describe('Test runner isolation',()=>{
 it('runs every Mocha suite and leaves node:test clock mocks to isolated Node processes',async()=>{
  const dir=resolve(__dirname),files=await hre.run(TASK_TEST_GET_TEST_FILES,{testFiles:[]});
  expect(files.slice().sort()).deep.eq(readdirSync(dir).filter(f=>f.endsWith('.test.js')).map(f=>resolve(dir,f)).sort());
  for(const file of files)expect(readFileSync(file,'utf8')).not.match(/from ['"]node:test['"]/);
 });
 it('rejects accidental explicit mixed-runner execution instead of silently skipping it',async()=>{
  await expect(hre.run(TASK_TEST_GET_TEST_FILES,{testFiles:['test/story-backup.test.mjs']})).rejectedWith('node --test');
 });
});
