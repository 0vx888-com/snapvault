// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SnapVault - 私密付费内容（阅后即焚）的链上付款与访问记录
/// @notice 合约只负责：定价、收款分账、记录访问过期时间。
///         内容密文存链下/DeWEB，解密密钥由链下服务监听 Purchase 事件后经 TapeSend 投递（TODO）。
contract SnapVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Content {
        address creator;
        address token;      // address(0) = 原生币 OKB
        uint256 price;
        uint64 viewSeconds; // 购买后可访问时长
        uint32 maxSupply;   // 0 = 不限量
        uint32 sold;
        bool active;
        bytes32 blobHash;   // 密文哈希（sha256）
        string blobURI;     // 密文位置 ipfs:// / tape:// / https://
    }

    uint16 public constant MAX_FEE_BPS = 3000;
    uint16 public feeBps;
    address public treasury;
    uint256 public nextId = 1;

    mapping(uint256 => Content) public contents;
    mapping(uint256 => mapping(address => uint64)) public accessUntil;
    mapping(address => mapping(address => uint256)) public balances; // creator => token => amount

    event Listed(uint256 indexed id, address indexed creator, address token, uint256 price, uint64 viewSeconds, uint32 maxSupply, bytes32 blobHash, string blobURI);
    event Delisted(uint256 indexed id);
    event Purchase(uint256 indexed id, address indexed fan, address indexed creator, address token, uint256 price, uint256 fee, uint64 accessUntil);
    event Withdraw(address indexed creator, address indexed token, uint256 amount);
    event FeeUpdated(uint16 feeBps, address treasury);

    error BadParams();
    error NotCreator();
    error Inactive();
    error SoldOut();
    error WrongValue();
    error NothingToWithdraw();

    constructor(address _treasury, uint16 _feeBps) Ownable(msg.sender) {
        if (_treasury == address(0) || _feeBps > MAX_FEE_BPS) revert BadParams();
        treasury = _treasury;
        feeBps = _feeBps;
    }

    function setFee(uint16 _feeBps, address _treasury) external onlyOwner {
        if (_treasury == address(0) || _feeBps > MAX_FEE_BPS) revert BadParams();
        feeBps = _feeBps;
        treasury = _treasury;
        emit FeeUpdated(_feeBps, _treasury);
    }

    function list(address token, uint256 price, uint64 viewSeconds, uint32 maxSupply, bytes32 blobHash, string calldata blobURI)
        external returns (uint256 id)
    {
        if (price == 0 || viewSeconds == 0 || blobHash == bytes32(0)) revert BadParams();
        id = nextId++;
        contents[id] = Content(msg.sender, token, price, viewSeconds, maxSupply, 0, true, blobHash, blobURI);
        emit Listed(id, msg.sender, token, price, viewSeconds, maxSupply, blobHash, blobURI);
    }

    function delist(uint256 id) external {
        if (contents[id].creator != msg.sender) revert NotCreator();
        contents[id].active = false;
        emit Delisted(id);
    }

    function purchase(uint256 id) external payable nonReentrant {
        Content storage c = contents[id];
        if (!c.active) revert Inactive();
        if (c.maxSupply != 0 && c.sold >= c.maxSupply) revert SoldOut();
        uint256 price = c.price;
        if (c.token == address(0)) {
            if (msg.value != price) revert WrongValue();
        } else {
            if (msg.value != 0) revert WrongValue();
            IERC20(c.token).safeTransferFrom(msg.sender, address(this), price);
        }
        uint256 fee = (price * feeBps) / 10_000;
        c.sold += 1;
        balances[c.creator][c.token] += price - fee;
        balances[treasury][c.token] += fee;
        uint64 until = uint64(block.timestamp) + c.viewSeconds;
        accessUntil[id][msg.sender] = until;
        emit Purchase(id, msg.sender, c.creator, c.token, price, fee, until);
    }

    function hasAccess(uint256 id, address fan) external view returns (bool) {
        return accessUntil[id][fan] >= block.timestamp;
    }

    function withdraw(address token) external nonReentrant {
        uint256 amt = balances[msg.sender][token];
        if (amt == 0) revert NothingToWithdraw();
        balances[msg.sender][token] = 0;
        if (token == address(0)) {
            (bool ok, ) = msg.sender.call{value: amt}("");
            require(ok, "transfer failed");
        } else {
            IERC20(token).safeTransfer(msg.sender, amt);
        }
        emit Withdraw(msg.sender, token, amt);
    }
}
