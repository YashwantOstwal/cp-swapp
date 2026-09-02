use anchor_lang::prelude::*;

#[constant]
pub const LP_MINT_STATIC_SEED: &[u8] = b"lp_mint";

#[constant]
pub const POOL_AUTHORITY:&str = "pool_authority";

#[constant]
pub const MINIMUM_LIQUIDITY:u64 = 100;

#[constant]
pub const MAX_SWAP_FEES_BASIS_POINTS:u16 = 10000;