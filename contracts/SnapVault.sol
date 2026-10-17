// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title SnapVault - 私密付费内容（阅后即焚）的链上付款与访问记录
/// @notice 合约负责定价、收款分账与购买权限。首次打开后的展示倒计时由交付服务负责。
///         内容密文存链下/DeWEB，解密密钥由链下服务监听 Purchase 事件后经 TapeSend 投递（TODO）。
contract SnapVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Content {
        address creator;
        address token;      // address(0) = 原生币 OKB
        uint256 price;
        uint64 viewSeconds; // 首次打开后的展示时长，由客户端/交付服务执行
        uint32 maxSupply;   // 0 = 不限量
        uint32 sold;
        bool active;
        bytes32 blobHash;   // 密文哈希（sha256）
        string blobURI;     // 密文位置 ipfs:// / tape:// / https://
    }

    uint16 public constant MAX_FEE_BPS = 1500;
    uint64 public constant PURCHASE_ACCESS_SECONDS = 24 hours;
    uint16 public feeBps;
    address public treasury;
    uint256 public nextId = 1;
    mapping(address => bool) public allowedTokens;

    mapping(uint256 => Content) public contents;
    mapping(uint256 => mapping(address => uint64)) public accessUntil;
    mapping(uint256 => bool) public ephemeral; // 展示选项，不保证买家不能保存密钥或明文
    mapping(address => mapping(address => uint256)) public balances; // creator => token => amount

    event Listed(uint256 indexed id, address indexed creator, address token, uint256 price, uint64 viewSeconds, uint32 maxSupply, bytes32 blobHash, string blobURI);
    event TokenAllowed(address indexed token, bool allowed);
    event Delisted(uint256 indexed id);
    event Purchase(uint256 indexed id, address indexed fan, address indexed creator, address token, uint256 price, uint256 fee, uint64 accessUntil);
    event Withdraw(address indexed creator, address indexed token, uint256 amount);
    event FeeUpdated(uint16 feeBps, address treasury);
    event DisplayRule(uint256 indexed id, bool ephemeral, uint64 viewSeconds);

    error BadParams();
    error NotCreator();
    error Inactive();
    error SoldOut();
    error WrongValue();
    error NothingToWithdraw();
    error AlreadyPurchased();
    error CreatorCannotPurchase();

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

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0) || token.code.length == 0) revert BadParams();
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function _checkToken(address token) internal view {
        if (token != address(0) && !allowedTokens[token]) revert BadParams();
    }

    function list(address token, uint256 price, uint64 viewSeconds, uint32 maxSupply, bytes32 blobHash, string calldata blobURI)
        external returns (uint256 id)
    {
        return _list(token, price, viewSeconds, maxSupply, blobHash, blobURI, true);
    }

    function listWithOptions(address token, uint256 price, uint64 viewSeconds, uint32 maxSupply, bytes32 blobHash, string calldata blobURI, bool burn)
        external returns (uint256 id)
    {
        return _list(token, price, viewSeconds, maxSupply, blobHash, blobURI, burn);
    }

    function _list(address token, uint256 price, uint64 viewSeconds, uint32 maxSupply, bytes32 blobHash, string memory blobURI, bool burn)
        internal returns (uint256 id)
    {
        _checkToken(token);
        if (price == 0 || viewSeconds == 0 || blobHash == bytes32(0)) revert BadParams();
        id = nextId++;
        contents[id] = Content(msg.sender, token, price, viewSeconds, maxSupply, 0, true, blobHash, blobURI);
        ephemeral[id] = burn;
        emit Listed(id, msg.sender, token, price, viewSeconds, maxSupply, blobHash, blobURI);
        emit DisplayRule(id, burn, viewSeconds);
    }

    function delist(uint256 id) external {
        if (contents[id].creator != msg.sender) revert NotCreator();
        contents[id].active = false;
        emit Delisted(id);
    }

    function purchase(uint256 id) external payable virtual nonReentrant {
        _purchase(id);
    }

    function _purchase(uint256 id) internal virtual {
        Content storage c = contents[id];
        if (accessUntil[id][msg.sender] != 0) revert AlreadyPurchased();
        if (!c.active) revert Inactive();
        if (msg.sender == c.creator) revert CreatorCannotPurchase();
        if (c.maxSupply != 0 && c.sold >= c.maxSupply) revert SoldOut();
        _checkToken(c.token);
        uint256 price = c.price;
        if (c.token == address(0)) {
            if (msg.value != price) revert WrongValue();
        } else {
            if (msg.value != 0) revert WrongValue();
            uint256 beforeBalance = IERC20(c.token).balanceOf(address(this));
            IERC20(c.token).safeTransferFrom(msg.sender, address(this), price);
            if (IERC20(c.token).balanceOf(address(this)) != beforeBalance + price) revert WrongValue();
        }
        uint256 fee = (price * feeBps) / 10_000;
        c.sold += 1;
        balances[c.creator][c.token] += price - fee;
        balances[treasury][c.token] += fee;
        // 购买资格与首次打开后的 5/10/30 秒展示是两件事。
        uint64 until = uint64(block.timestamp) + PURCHASE_ACCESS_SECONDS;
        accessUntil[id][msg.sender] = until;
        emit Purchase(id, msg.sender, c.creator, c.token, price, fee, until);
    }

    function hasAccess(uint256 id, address fan) external view returns (bool) {
        return accessUntil[id][fan] != 0 && accessUntil[id][fan] >= block.timestamp;
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
