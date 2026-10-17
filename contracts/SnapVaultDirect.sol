// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {SnapVaultCheckout} from "./SnapVaultCheckout.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Ordinary wallets need no TapeOut container. Both checkout routes
/// require an operator readiness quote before payment. Delivery remains a service.
contract SnapVaultDirect is SnapVaultCheckout {
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
}
