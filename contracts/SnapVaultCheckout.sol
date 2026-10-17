// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {SnapVault} from "./SnapVault.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IDeliveryHub {
    struct Key { address container; bytes32 endpoint; bool opened; address current; uint8 suite; uint16 keyIndex; bytes32 key; bool usable; uint32 version; uint64 chains; }
    function keyFor(address circuits, uint256 tokenId) external view returns (Key memory);
}
/// @notice Test checkout. A delivery-service quote is required BEFORE taking money.
/// A quote attests readiness, not guaranteed delivery. No automatic refunds or audit.
contract SnapVaultCheckout is SnapVault {
    address public immutable deliveryHub;
    address public immutable deliveryOperator;
    bytes32 public constant QUOTE_TYPEHASH = keccak256("DeliveryQuote(uint256 id,address buyer,address circuits,uint256 tokenId,bytes32 key,uint256 deadline)");
    mapping(uint256 => mapping(address => bytes32)) public recipient;
    event DeliveryRequested(uint256 indexed id, address indexed buyer, address circuits, uint256 tokenId, bytes32 endpoint, bytes32 key);
    error DeliveryNotReady();
    constructor(address treasury_, uint16 fee_, address hub_, address operator_)
        SnapVault(treasury_, fee_) {
        if (hub_ == address(0) || operator_ == address(0)) revert BadParams();
        deliveryHub = hub_; deliveryOperator = operator_;
    }
    // Legacy checkout cannot bypass delivery authorization.
    function purchase(uint256) external payable override { revert DeliveryNotReady(); }
    function quoteDigest(uint256 id, address buyer, address circuits, uint256 tokenId, bytes32 key, uint256 deadline) public view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("SnapVaultCheckout"), keccak256("1"), block.chainid, address(this)));
        return keccak256(abi.encodePacked(hex"1901", domain, keccak256(abi.encode(QUOTE_TYPEHASH, id, buyer, circuits, tokenId, key, deadline))));
    }
    function purchaseDelivered(uint256 id, address circuits, uint256 tokenId, bytes32 key, uint256 deadline, bytes calldata signature) external payable nonReentrant {
        if (deadline < block.timestamp || deadline > block.timestamp + 5 minutes || deliveryHub.code.length == 0) revert DeliveryNotReady();
        if (ECDSA.recover(quoteDigest(id, msg.sender, circuits, tokenId, key, deadline), signature) != deliveryOperator) revert DeliveryNotReady();
        IDeliveryHub.Key memory target = IDeliveryHub(deliveryHub).keyFor(circuits, tokenId);
        if (!target.opened || !target.usable || target.suite != 1 || target.current != msg.sender || target.key != key || target.chains == 0) revert DeliveryNotReady();
        recipient[id][msg.sender] = target.endpoint;
        _purchase(id);
        emit DeliveryRequested(id, msg.sender, circuits, tokenId, target.endpoint, key);
    }
}
