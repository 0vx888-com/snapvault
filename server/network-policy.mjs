// Mainnet is opt-in and bound to explicit deployment/identity configuration.
import {getAddress,ZeroAddress} from 'ethers';
export const XLAYER_HUB='0xe61a9c7213a6aa616c246a2b569e555b417b25ee';
export const XLAYER_HUB_IMPL='0xdcc57797089ebd9f26e686379a4323f353a3f9c6';
export const XLAYER_HUB_HASH='0xf97f9432aefd6f305f610fbe6c789a8f4facfc251fcaf39e06d8c1f2c2881b61';
export const OLD_TEST_WALLET='0x1538ac2d29d03615d2336a2227900aab334d9402';
export const OLD_OPERATOR='0x010699a0e280a4325652f6d26be2275e23a21506';
export function networkPolicy(config,{local=false}={}){
 const chainId=Number(config.chainId);
 if(![196,1952,...(local?[31337]:[])].includes(chainId))throw Error('Unsupported chain; expected X Layer 196/1952 or explicit local test');
 if(chainId===196){
  if(config.mainnetEnabled!==true||config.mainnetAcknowledgement!=='X_LAYER_MAINNET_196')throw Error('Mainnet requires explicit enablement and acknowledgement');
  for(const k of ['owner','treasury','operator']){if(!config[k]||getAddress(config[k])===ZeroAddress)throw Error('Explicit mainnet '+k+' required');}
  const identities=[config.owner,config.treasury,config.operator].map(x=>x.toLowerCase());
  if(identities.some(x=>[OLD_TEST_WALLET,OLD_OPERATOR].includes(x)))throw Error('Test wallet/operator forbidden on mainnet');
  if(config.operator.toLowerCase()===config.owner.toLowerCase()||config.operator.toLowerCase()===config.treasury.toLowerCase())throw Error('Operator must be separate from owner/treasury');
  if(!Number.isInteger(config.confirmations)||config.confirmations<6)throw Error('Mainnet requires at least 6 confirmations');
  if(!config.tapeSend?.enabled)throw Error('Production requires configured TapeSend with ordinary fallback');
  if(config.tapeSend.hub?.toLowerCase()!==XLAYER_HUB||config.tapeSend.implementation?.toLowerCase()!==XLAYER_HUB_IMPL||config.tapeSend.implementationHash!==XLAYER_HUB_HASH)throw Error('Mainnet requires the pinned official TapeSend Hub');
 }
 return {chainId,mainnet:chainId===196,local:chainId===31337,symbol:chainId===196?'OKB':'测试 OKB',networkName:chainId===196?'X Layer 主网':chainId===1952?'X Layer 测试网':'本地链',paymentsEnabled:true};
}
