export const ZERO = 0

export const MAX_PACKET_SIZE = 10 * 1024 * 1024
export const REPEATED_OVERHEAD = 6
export const BYTES_OVERHEAD = 6
export const HASH_SIZE = 32

// Header sizes
export const DIFFICULTY_SIZE = 4
export const TIMESTAMP_SIZE = 8
export const NONCE_SIZE = 8
export const MINER_SIZE = 20

// Tx sizes
export const AMOUNT_SIZE = 8
export const FEE_SIZE = 8
export const TX_NONCE_SIZE = 4
export const SIGNATURE_SIZE = 64
export const RECOVERY_SIZE = 4

export const MAX_HEADER_SIZE = 3 * (HASH_SIZE + BYTES_OVERHEAD) + REPEATED_OVERHEAD + DIFFICULTY_SIZE + TIMESTAMP_SIZE + NONCE_SIZE + MINER_SIZE + BYTES_OVERHEAD
export const MAX_TX_SIZE = 2 * (HASH_SIZE + BYTES_OVERHEAD) + AMOUNT_SIZE + FEE_SIZE + TX_NONCE_SIZE + SIGNATURE_SIZE + BYTES_OVERHEAD + RECOVERY_SIZE
export const MAX_TXS_PER_BLOCK = 4096
export const MAX_BLOCK_SIZE = MAX_HEADER_SIZE + MAX_TXS_PER_BLOCK * MAX_TX_SIZE
export const MAX_HEADERS_PER_PACKET = Math.floor(MAX_PACKET_SIZE / MAX_HEADER_SIZE)
export const MAX_BLOCKS_PER_PACKET = Math.floor(MAX_PACKET_SIZE / MAX_BLOCK_SIZE)