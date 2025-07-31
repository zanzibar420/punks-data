// Common Solidity error selectors
const errorSelectors = {
  '0x118cdaa7': 'AddressAlreadyMinted() - common in NFT contracts with one-per-address limits',
  '0x08c379a0': 'Error(string) - generic revert with message',
  '0x4e487b71': 'Panic(uint256) - arithmetic errors, array bounds, etc',
  '0xe2517d3f': 'InsufficientFunds()',
  '0x990a0bda': 'Unauthorized() or AccessDenied()',
  '0x82b42900': 'Unauthorized() - another common variant'
};

const errorData = '0x118cdaa70000000000000000000000000033abd22b24ef80942c5794ad8ea2b215dd5151';
const selector = errorData.slice(0, 10);
const address = '0x' + errorData.slice(34);

console.log('🔍 Error Analysis:');
console.log(`📋 Selector: ${selector}`);
console.log(`🏠 Address: ${address}`);
console.log(`❓ Likely meaning: ${errorSelectors[selector] || 'Unknown error'}`);

// The address in the error matches Signer 1, suggesting this address has already minted
console.log('\n💡 Analysis:');
console.log('This appears to be an "AddressAlreadyMinted" error.');
console.log('The contract likely has a one-mint-per-address restriction.');
console.log('Only the owner wallet can mint to any address - other wallets can only mint to themselves once.');