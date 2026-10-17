// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
/// @dev LOCAL TEST ONLY. Not a TapeOut container, and never deployed by the UI.
contract TapeOutFixture {
    mapping(uint256 => address) public ownerOf;
    mapping(address => bool) public paid;
    function isCPU(address a) external view returns(bool){return a==address(this);}
    function implementation() external view returns(address){return address(this);}
    function setOwner(uint256 id,address who) external{require(block.chainid==31337);ownerOf[id]=who;}
    function setPaid(address a,bool v) external{require(block.chainid==31337);paid[a]=v;}
    function account(address impl,bytes32 salt,uint256 chain,address cpu,uint256 id) external view returns(address){return address(uint160(uint256(keccak256(abi.encode(address(this),impl,salt,chain,cpu,id)))));}
}
