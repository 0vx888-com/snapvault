// Exact mainnet app origins; retain all deployment-configured DeWEB origins.
export function mainnetAppOrigins(origins) {
 return [...new Set([...origins, 'https://www.snapvault.cc', 'https://snapvault.cc'])];
}
