// Portable defaults: an explicit override or Playwright-managed Chromium.
const {tmpdir}=require('node:os');const {join}=require('node:path');const {mkdirSync}=require('node:fs');
function launchOptions(){return {headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})};}
function tempPath(name){const dir=join(tmpdir(),'snapvault-browser-tests');mkdirSync(dir,{recursive:true});return join(dir,name);}
module.exports={launchOptions,tempPath};
