// Public deployment materials only. Does not connect to an RPC or sign transactions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/contracts/SnapVault.sol/SnapVault.json')));
const bundle = { contractName: artifact.contractName, compiler: require('solc').version(), evmVersion: 'paris', optimizerRuns: 200, constructor: { treasury: 'nonzero address', feeBps: 'integer 0..3000; default 1000 = 10%' }, sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'contracts/SnapVault.sol'))).digest('hex'), abi: artifact.abi, bytecode: artifact.bytecode };
fs.mkdirSync(path.join(root, 'deployment'), { recursive: true });
fs.writeFileSync(path.join(root, 'deployment/SnapVault.json'), JSON.stringify(bundle, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'web/abi.js'), 'export const SNAPVAULT_ABI = ' + JSON.stringify(artifact.abi) + ';\n');
console.log('已生成 deployment/SnapVault.json 和 web/abi.js；未发送交易。');

const checkout = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/contracts/SnapVaultCheckout.sol/SnapVaultCheckout.json')));
fs.writeFileSync(path.join(root, 'deployment/SnapVaultCheckout.json'), JSON.stringify({abi:checkout.abi, bytecode:checkout.bytecode},null,2)+'\n');
fs.mkdirSync(path.join(root, 'web/deployment'), { recursive:true });
fs.copyFileSync(path.join(root,'deployment/SnapVaultCheckout.json'),path.join(root,'web/deployment/SnapVaultCheckout.json'));

const probe = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/contracts/SnapVaultPaymentProbe.sol/SnapVaultPaymentProbe.json')));
for (const location of ['deployment','web/deployment']) fs.writeFileSync(path.join(root,location,'SnapVaultPaymentProbe.json'),JSON.stringify({abi:probe.abi,bytecode:probe.bytecode},null,2)+'\n');
