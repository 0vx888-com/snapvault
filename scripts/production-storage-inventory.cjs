// READ ONLY. Run manually on the existing service. No decrypt, backups, RPC or writes.
const fs=require('node:fs'),p=require('node:path');
let cfg={};
try{cfg=process.env.SNAPVAULT_WALLET_CONFIG_JSON?JSON.parse(process.env.SNAPVAULT_WALLET_CONFIG_JSON):JSON.parse(fs.readFileSync(process.env.SNAPVAULT_WALLET_CONFIG||'/app/config/wallet.json','utf8'));}catch{throw Error('Cannot identify configured data directory; stop instead of guessing');}
const mount=process.env.RAILWAY_VOLUME_MOUNT_PATH||'/data';
let skipped=0;
function size(file){const s=fs.lstatSync(file);if(s.isSymbolicLink()){skipped++;return {bytes:0,allocatedBytes:0,files:0};}if(s.isFile())return {bytes:s.size,allocatedBytes:s.blocks*512,files:1};let t={bytes:0,allocatedBytes:0,files:0};if(s.isDirectory())for(const name of fs.readdirSync(file)){const row=size(p.join(file,name));for(const k of Object.keys(t))t[k]+=row[k];}return t;}
const st=fs.statfsSync(mount),dataDir=cfg.dataDir,state=fs.statSync(p.join(dataDir,'state.enc'));
if(!p.resolve(dataDir).startsWith(p.resolve(mount)+'/'))throw Error('Data directory outside known mount');
console.log(JSON.stringify({checkedAt:new Date().toISOString(),readOnly:true,mount,dataDir,filesystem:{capacityBytes:st.blocks*st.bsize,availableBytes:st.bavail*st.bsize,usedBytes:(st.blocks-st.bfree)*st.bsize},total:size(mount),data:size(dataDir),backups:size(cfg.backupDir||p.join(dataDir,'backups')),stateBytes:state.size,skippedSymlinks:skipped,contentDecrypted:false,secretsPrinted:false},null,2));
