// selectors.js
// A list of common Ethereum function selectors (Keccak-256 derived) for reference in smart contract interactions, vouchers, or ABI parsing.
// Derived from standard interfaces (ERC20, Ownable) and Cartesi-specific functions.
// Usage: Import and filter/map as needed, e.g., const withdrawEther = SELECTORS.find(s => s.selector === '0x522f6815');

const SELECTORS = [
  {
    selector: '0xa9059cbb',
    signature: 'transfer(address,uint256)',
    description: 'Transfers ERC20 tokens to a recipient. Common in token contracts.'
  },
  {
    selector: '0x095ea7b3',
    signature: 'approve(address,uint256)',
    description: 'Approves a spender to transfer ERC20 tokens on behalf of the owner.'
  },
  {
    selector: '0x70a08231',
    signature: 'balanceOf(address)',
    description: 'Returns the ERC20 token balance of an address.'
  },
  {
    selector: '0x18160ddd',
    signature: 'totalSupply()',
    description: 'Returns the total supply of ERC20 tokens.'
  },
  {
    selector: '0x8da5cb5b',
    signature: 'owner()',
    description: 'Returns the owner address in Ownable contracts.'
  },
  {
    selector: '0xf2fde38b',
    signature: 'transferOwnership(address)',
    description: 'Transfers ownership in Ownable contracts.'
  },
  {
    selector: '0x3ccfd60b',
    signature: 'withdraw()',
    description: 'Withdraws the full contract balance (often to msg.sender). Common in simple vaults.'
  },
  {
    selector: '0x2e1a7d4d',
    signature: 'withdraw(uint256)',
    description: 'Withdraws a specified amount (e.g., in WETH contracts).'
  },
  {
    selector: '0xd0e30db0',
    signature: 'deposit()',
    description: 'Deposits ETH to mint WETH or similar.'
  },
  {
    selector: '0x522f6815',
    signature: 'withdrawEther(address,uint256)',
    description: 'Withdraws ETH from the DApp contract to a recipient (Cartesi-specific for vouchers).'
  },
  {
    selector: '0x49948e0e',
    signature: 'depositEther(address,bytes)',
    description: 'Deposits ETH via the EtherPortal, specifying the DApp address and optional data (Cartesi-specific).'
  },
  {
    selector: '0x9c3ba68e',
    signature: 'executeVoucher(address,bytes,bytes32[])',
    description: 'Executes a voucher on the Application contract, with proof for validation (Cartesi-specific for off-chain outputs).'
  },
  {
    selector: '0xd9caed12',
    signature: 'withdraw(address,uint256)',
    description: 'Variant withdraw in some vaults or tokens.'
  },
  {
    selector: '0x23b872dd',
    signature: 'transferFrom(address,address,uint256)',
    description: 'Transfers ERC20 tokens from one address to another (with approval).'
  },
  {
    selector: '0xdd62ed3e',
    signature: 'allowance(address,address)',
    description: 'Returns ERC20 allowance for a spender.'
  }
];

module.exports = SELECTORS;  // For Node.js/CommonJS import