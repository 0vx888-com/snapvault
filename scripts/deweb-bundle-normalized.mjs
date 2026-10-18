import {loadDewebBundle as loadOriginal,uploadPlan as originalPlan,REGISTRY_ABI} from './deweb-bundle.mjs';
export {REGISTRY_ABI};
export function loadDewebBundle(...args){const bundle=loadOriginal(...args);return {...bundle,files:bundle.files.map(f=>({...f,path:f.path.replace(/^\/+/, '')}))};}
export function uploadPlan(bundle,container,registry){const plan=originalPlan(bundle,container,registry);const last=plan.at(-1);if(last.path!=='fallback')throw Error('Expected fallback last');return plan.slice(0,-1).concat({...last,data:new Interface(REGISTRY_ABI).encodeFunctionData('setFallback',[container,'index.html'])});}
import {Interface} from 'ethers';
