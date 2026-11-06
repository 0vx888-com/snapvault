// Versioned policy: old snapshots keep their original business-digest semantics.
export function backupGeneration(value){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||!/^g-[a-z0-9][a-z0-9-]{0,60}$/.test(value))throw Error('Invalid backup generation');
 return value;
}
export function snapshotState(state){
 const copy=structuredClone(state);
 if(copy.backupPolicyVersion!==undefined&&copy.backupPolicyVersion!==1)throw Error('Unsupported backup policy');
 // Cursor and anchor are reproducible scan progress, never order/transaction data.
 // Restoring an older cursor replays logs; no payment or delivery status is ignored.
 if(copy.backupPolicyVersion===1&&copy.orderIndex){delete copy.orderIndex.cursor;delete copy.orderIndex.anchor;}
 return copy;
}
