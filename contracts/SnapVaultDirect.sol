// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {SnapVaultCheckout} from "./SnapVaultCheckout.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Ordinary wallets need no TapeOut container. Both checkout routes
/// require an operator readiness quote before payment. Delivery remains a service.
contract SnapVaultDirect is SnapVaultCheckout {
    using SafeERC20 for IERC20;
    struct Payment { address token; uint256 amount; bool refunded; }
    mapping(uint256 => mapping(address => Payment)) public payments;
    event DeliveryRefunded(uint256 indexed id, address indexed buyer, address token, uint256 amount);
    bytes32 public constant DIRECT_TYPEHASH = keccak256("DirectQuote(uint256 id,address buyer,bytes32 keyHash,uint256 deadline)");
    mapping(uint256 => mapping(address => bytes32)) public directKeyHash;
    event DirectRequested(uint256 indexed id, address indexed buyer, bytes32 keyHash);
    constructor(address treasury_, uint16 fee_, address hub_, address operator_)
        SnapVaultCheckout(treasury_, fee_, hub_, operator_) {}

    function directDigest(uint256 id, address buyer, bytes32 keyHash, uint256 deadline) public view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("SnapVaultDirect"), keccak256("1"), block.chainid, address(this)));
        return keccak256(abi.encodePacked(hex"1901", domain, keccak256(abi.encode(DIRECT_TYPEHASH, id, buyer, keyHash, deadline))));
    }
    function purchaseDirect(uint256 id, bytes32 keyHash, uint256 deadline, bytes calldata signature) external payable nonReentrant {
        if (keyHash == bytes32(0) || deadline < block.timestamp || deadline > block.timestamp + 5 minutes) revert DeliveryNotReady();
        if (ECDSA.recover(directDigest(id, msg.sender, keyHash, deadline), signature) != deliveryOperator) revert DeliveryNotReady();
        directKeyHash[id][msg.sender] = keyHash;
        _purchase(id);
        emit DirectRequested(id, msg.sender, keyHash);
    }

    function _purchase(uint256 id) internal override {
        if (payments[id][msg.sender].refunded) revert AlreadyPurchased();
        super._purchase(id);
        Content storage c = contents[id];
        payments[id][msg.sender] = Payment(c.token, c.price, false);
    }

    /// @notice Owner adjudicates an off-chain delivery failure and funds a FULL refund.
    /// Existing creator/treasury credits are not seized, even if already withdrawn.
    /// This is a funded recovery path, not trustless proof of non-delivery.
    function refundDelivery(uint256 id, address buyer) external payable onlyOwner nonReentrant {
        Payment storage p = payments[id][buyer];
        if (p.amount == 0 || p.refunded) revert BadParams();
        p.refunded = true;
        accessUntil[id][buyer] = 0;
        delete directKeyHash[id][buyer];
        delete recipient[id][buyer];
        if (p.token == address(0)) {
            if (msg.value != p.amount) revert WrongValue();
            (bool ok,) = buyer.call{value: p.amount}("");
            require(ok, "refund transfer failed");
        } else {
            if (msg.value != 0) revert WrongValue();
            uint256 beforeBalance = IERC20(p.token).balanceOf(address(this));
            IERC20(p.token).safeTransferFrom(msg.sender, address(this), p.amount);
            if (IERC20(p.token).balanceOf(address(this)) != beforeBalance + p.amount) revert WrongValue();
            IERC20(p.token).safeTransfer(buyer, p.amount);
        }
        emit DeliveryRefunded(id, buyer, p.token, p.amount);
    }
}
