// Local-only fork verification. No public accounts or public deployment network selected.
const base=require('./hardhat.config.js');module.exports={...base,networks:{hardhat:{hardfork:'shanghai',forking:{url:'https://rpc.xlayer.tech'},chains:{196:{hardforkHistory:{shanghai:0}}}}}};
