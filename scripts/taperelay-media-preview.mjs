// Loopback-only helpers for the TapeRelay media mock preview. Not used in production builds.
import {WalletService} from '../server/wallet-service.mjs';

export const PREVIEW_HOST = '127.0.0.1';
export const PREVIEW_VAULT = '0x' + '44'.repeat(20);
export const PREVIEW_ACCOUNTS = Object.freeze({
  alice: {token: 'preview-alice', account: '0x' + '11'.repeat(20), name: 'Alice'},
  bob: {token: 'preview-bob', account: '0x' + '22'.repeat(20), name: 'Bob'},
  eve: {token: 'preview-eve', account: '0x' + '33'.repeat(20), name: 'Eve'},
});
const OWNER = '0x' + '55'.repeat(20);

export function previewChainStubs() {
  return {
    provider: {
      getNetwork: async () => ({chainId: 31337}),
      send: async (method) => {
        if (method === 'eth_blockNumber') return '0x0';
        throw Object.assign(Error('Preview has no chain method: ' + method), {status: 501});
      },
      getBlock: async () => null,
      getLogs: async () => [],
      getBlockNumber: async () => 0,
      getTransaction: async () => null,
      getTransactionReceipt: async () => null,
    },
    vault: {
      target: PREVIEW_VAULT,
      interface: {fragments: [], getEvent() { return null; }, parseLog() { return null; }},
      feeBps: async () => 1000,
      contents: async () => { throw Object.assign(Error('Preview has no listed content'), {status: 501}); },
      accessUntil: async () => 0n,
      owner: async () => OWNER,
      payments: async () => ({amount: 0n, refunded: false, token: '0x0000000000000000000000000000000000000000'}),
      balances: async () => 0n,
      deliveryOperator: async () => OWNER,
    },
  };
}

export function createTapeRelayPreviewService({dir, origin}) {
  const host = new URL(origin).hostname;
  if (host !== PREVIEW_HOST) throw Error('Preview service is loopback-only');
  const {alice, bob, eve} = PREVIEW_ACCOUNTS;
  const {provider, vault} = previewChainStubs();
  const service = new WalletService({
    dir,
    origins: [origin],
    allowLocalKeyFile: true,
    operator: {address: alice.account},
    provider,
    vault,
  });
  service.state.profiles = {
    [alice.account]: {name: alice.name},
    [bob.account]: {name: bob.name},
    [eve.account]: {name: eve.name},
  };
  service.state.friends = [{from: alice.account, to: bob.account, status: 'accepted', ts: Date.now() - 60_000}];
  service.state.convs = [
    {id: 'preview-dm', type: 'dm', name: '', members: [alice.account, bob.account], admin: alice.account, ts: Date.now() - 50_000, shot: 'allow'},
    {id: 'preview-group', type: 'group', name: '预览群', members: [alice.account, bob.account], admin: alice.account, ts: Date.now() - 40_000, shot: 'allow'},
  ];
  const text = (value) => service.seal(Buffer.from(JSON.stringify({text: value, image: null, mediaId: null})));
  service.state.messages = [
    {id: 'preview-msg-dm-1', conv: 'preview-dm', from: alice.account, ts: Date.now() - 30_000, kind: 'message', burn: false, secs: 10, shot: 'allow', opens: {}, payload: text('预览私聊：可用附件发送图片或视频。')},
    {id: 'preview-msg-dm-2', conv: 'preview-dm', from: bob.account, ts: Date.now() - 20_000, kind: 'message', burn: false, secs: 10, shot: 'allow', opens: {}, payload: text('已是好友，可直接打开此会话验收。')},
    {id: 'preview-msg-group-1', conv: 'preview-group', from: alice.account, ts: Date.now() - 10_000, kind: 'message', burn: false, secs: 10, shot: 'allow', opens: {}, payload: text('预览群：仅 Alice 与 Bob 是成员。Eve 不应看到此会话。')},
  ];
  const until = Date.now() + 24 * 60 * 60 * 1000;
  for (const account of Object.values(PREVIEW_ACCOUNTS)) {
    service.sessions.set(account.token, {account: account.account, origin, until});
  }
  service.configureTapeRelayMedia({enabled: true, mode: 'mock'});
  return service;
}
