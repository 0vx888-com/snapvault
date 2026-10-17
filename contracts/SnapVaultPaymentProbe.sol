// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {SnapVault} from "./SnapVault.sol";
/// @notice TEST COINS ONLY: payment/accounting rehearsal, no content or TapeSend delivery.
/// Never deploy this as the production or competition-integrated checkout.
contract SnapVaultPaymentProbe is SnapVault {
    uint256 public constant PROBE_PRICE = 0.00001 ether;
    address public immutable testBuyer;
    constructor(address creator_, address buyer_) SnapVault(creator_, 1000) {
        if ((block.chainid != 1952 && block.chainid != 31337) || creator_ != msg.sender || buyer_ == address(0) || buyer_ == creator_) revert BadParams();
        testBuyer = buyer_;
        _list(address(0), PROBE_PRICE, 10, 1, sha256(bytes("SnapVault testnet payment probe: NO CONTENT DELIVERY")), "urn:snapvault:testnet-payment-probe:no-content-delivery", false);
    }
    function purchase(uint256 id) external payable override nonReentrant {
        if (msg.sender != testBuyer || id != 1) revert BadParams();
        _purchase(id);
    }
}
