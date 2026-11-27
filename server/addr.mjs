// Wallet addresses are compared case-insensitively. Stored friend/member
// strings may still carry mixed EIP-55 case from older records.
export const normAddr = (a) => String(a || '').toLowerCase();
export const sameAddr = (a, b) => {
  const left = normAddr(a), right = normAddr(b);
  return !!left && left === right;
};
export const listHasAddr = (list, a) => Array.isArray(list) && list.some((x) => sameAddr(x, a));
export const acceptedFriends = (friends, a, b) => (friends || []).some((f) => f.status === 'accepted' && listHasAddr([f.from, f.to], a) && listHasAddr([f.from, f.to], b));
